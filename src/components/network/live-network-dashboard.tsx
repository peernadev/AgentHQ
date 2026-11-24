"use client";

// Main dashboard (/): the network layout from /lab/network on live Firestore data (useMissionData).
import { useState, type ReactNode } from "react";
import { ArrowRight, Check, Plus, RotateCcw, Server, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AgentHQMark } from "@/components/agenthq-mark";
import { MissionCreator } from "@/components/mission-creator";
import { Network, TaskEvidence, WorkerStatus, age, assignedTask, missionLabels, taskLabels } from "@/components/network/network-parts";
import { useFirebaseAuth } from "@/lib/client/auth-provider";
import { useMissionData } from "@/lib/client/use-mission-data";
import { PLAN_CLAIM_MINUTES, type Agent, type Mission, type Task } from "@/types/api";
import styles from "../agent-network-dashboard.module.css";

type Board = ReturnType<typeof useMissionData>;
type Section = "mission" | "agents" | "queue" | "activity";
type QueueTab = "up-next" | "drafts" | "active" | "closed";
type Result = { kind: "ok" | "error"; text: string; draftId?: string };

const toolNames: Record<Agent["tool"], string> = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity", other: "Agent" };
const queueTabs: { id: QueueTab; label: string; statuses: Task["status"][] }[] = [
  { id: "up-next", label: "Up next", statuses: ["queued"] },
  { id: "drafts", label: "Drafts", statuses: ["draft"] },
  { id: "active", label: "In flight", statuses: ["claimed", "in_progress", "in_review"] },
  { id: "closed", label: "Done & failed", statuses: ["done", "failed", "cancelled"] },
];
const tabFor = (task: Task): QueueTab => queueTabs.find(tab => tab.statuses.includes(task.status))?.id ?? "up-next";
const liveLabel = (agent: Agent) => agent.name;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed. Please try again.";
}
function isCancelled(error: unknown) {
  return error instanceof Error && (error.name === "AbortError" || /cancel/i.test(error.name));
}

/** Reason and log from the task's latest "failed" event (the /fail route stores them there). */
function lastFailure(board: Board, task: Task) {
  const event = board.events.filter(item => item.task_id === task.id && item.type === "failed").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!event) return null;
  return {
    reason: typeof event.data?.reason === "string" ? event.data.reason : event.message ?? "No reason recorded.",
    log: typeof event.data?.log_excerpt === "string" ? event.data.log_excerpt : null,
  };
}
/** Where an orchestrator request stands: waiting, claimed, stalled (claim expired) or offline (never claimed in time). */
function requestState(requestedAt: string, claimedAt: string | null | undefined, claimedBy: string | null | undefined, now: number) {
  const limit = PLAN_CLAIM_MINUTES * 60 * 1000;
  const requested = Date.parse(requestedAt);
  const claimed = claimedAt ? Date.parse(claimedAt) : null;
  const name = claimedBy ?? "The orchestrator";
  if (!now) return { kind: "waiting" as const, since: requested, name };
  if (claimed !== null) return { kind: now - claimed < limit ? "claimed" as const : "stalled" as const, since: claimed, name };
  return { kind: now - requested < limit ? "waiting" as const : "offline" as const, since: requested, name };
}
function planningState(mission: Mission, now: number) {
  return requestState(mission.plan_requested_at ?? mission.created_at, mission.plan_claimed_at, mission.plan_claimed_by_name, now);
}
/** Section heading for a stored review, by who produced it. */
function reviewHeadingFor(task: Task) {
  const model = task.review?.model ?? "";
  if (model === "rules") return "Rules-only review (no AI)";
  if (model.startsWith("claude-code")) return `Claude review · ${/((.+))/.exec(model)?.[1] ?? "orchestrator"}`;
  return "Gemini review";
}

function PlanningPanel({ mission, now }: { mission: Mission; now: number }) {
  const state = planningState(mission, now);
  const origin = typeof window === "undefined" ? "https://agenthq-nine.vercel.app" : window.location.origin;
  const busy = state.kind === "waiting" || state.kind === "claimed";
  return <section className={styles.planningPanel} aria-labelledby="planning-heading" aria-live="polite">
    <div className={styles.planningStatus}>
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : <Server size={20} aria-hidden="true" />}
      <div>
        <h2 id="planning-heading">{state.kind === "waiting" ? "Waiting for the orchestrator…" : state.kind === "claimed" ? `${state.name} is drafting the plan…` : "No orchestrator online"}</h2>
        <p>{state.kind === "waiting" ? `Requested ${age(new Date(state.since).toISOString(), now)}. An orchestrator agent checks for plan requests every 30 seconds.`
          : state.kind === "claimed" ? `Claimed ${age(new Date(state.since).toISOString(), now)}. The drafts appear in Queue for your approval when it submits.`
          : state.kind === "stalled" ? `${state.name} claimed this ${age(new Date(state.since).toISOString(), now)} and stopped responding. Any orchestrator can take it over now.`
          : `Nobody picked this up within ${PLAN_CLAIM_MINUTES} minutes. The request stays open: start an orchestrator and it plans this mission next.`}</p>
      </div>
    </div>
    <div className={styles.detailSection}><h3>Goal</h3><p>{mission.goal}</p></div>
    {!busy && <div className={styles.detailSection}>
      <h3>Start an orchestrator on a laptop (in the repo)</h3>
      <pre className={styles.failureLog}>{`git pull\nHQ_URL=${origin} node cli/hq.mjs join --code <TEAM_JOIN_CODE> \\\n  --participant <your name> --name orchestrator-<you> --role orchestrator --tool claude\nclaude "Read prompts/orchestrator.md and run its loop."`}</pre>
      <small>PowerShell: <code>$env:HQ_URL=&quot;{origin}&quot;</code> before the join command. Details in prompts/orchestrator.md.</small>
    </div>}
  </section>;
}

/** A recovery draft proposed for this failed task that nobody has approved yet. */
function pendingRecovery(board: Board, task: Task): Task | null {
  const ids = board.events.filter(item => item.type === "recovery_proposed" && item.task_id === task.id)
    .map(item => item.data?.draft_task_id).filter((id): id is string => typeof id === "string");
  return board.allTasks.find(item => ids.includes(item.id) && item.status === "draft") ?? null;
}

export function LiveNetworkDashboard() {
  const board = useMissionData();
  const { user, signOut } = useFirebaseAuth();
  const [section, setSection] = useState<Section>("agents");
  const [selected, setSelected] = useState("server");
  const [creating, setCreating] = useState(false);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [mergeConfirmed, setMergeConfirmed] = useState<Record<string, string>>({});
  const [signOutError, setSignOutError] = useState("");
  const acting = board.approving || board.planning || board.actionTaskId !== null;
  const mission = board.mission;
  const tasks = board.tasks;
  const queueTab = (queueTabs.some(tab => tab.id === board.queueTab) ? board.queueTab : "up-next") as QueueTab;
  const rows = tasks.filter(task => queueTabs.find(tab => tab.id === queueTab)!.statuses.includes(task.status));
  const activeTask = rows.find(task => task.id === board.selectedTask?.id) ?? rows[0];

  const reviews = tasks.filter(task => task.status === "in_review");
  const failures = tasks.filter(task => task.status === "failed");
  const blocked = board.agents.filter(agent => agent.status === "blocked");
  const decisions = [
    ...reviews.map(task => ({ key: task.id, task, note: task.checks && Object.values(task.checks).some(pass => !pass) ? "Checks failed · human review" : "PR in review", title: task.title, description: "Review the evidence, then mark it done after the PR is merged." })),
    ...failures.map(task => ({ key: task.id, task, note: "Task failed", title: task.title, description: lastFailure(board, task)?.reason ?? "Inspect the failure and propose a recovery." })),
    ...blocked.map(agent => ({ key: agent.id, task: assignedTask(agent, tasks) ?? null, agent, note: `${board.participants.find(person => person.id === agent.participant_id)?.name ?? "Teammate"} · blocked`, title: `${agent.name} is blocked`, description: agent.note ?? "The worker needs a decision." })),
  ];
  const taskIds = new Set(tasks.map(task => task.id));
  const events = mission ? board.events.filter(event => event.mission_id === mission.id || (event.mission_id === null && event.task_id !== null && taskIds.has(event.task_id))) : [];
  const messages = board.messages.filter(message => !message.to_task || taskIds.has(message.to_task));
  const timeline = [
    ...events.filter(event => event.type !== "message").map(event => ({ id: `e-${event.id}`, at: event.created_at, title: event.message ?? event.type.replaceAll("_", " "), meta: `${event.type.replaceAll("_", " ")}${event.task_id ? ` · ${tasks.find(task => task.id === event.task_id)?.title ?? "task"}` : " · mission"}${typeof event.data?.by === "string" ? ` · ${event.data.by}` : ""}` })),
    ...messages.map(message => ({ id: `m-${message.id}`, at: message.created_at, title: message.text, meta: `message · ${message.from_name} → ${board.agents.find(agent => agent.id === message.to_agent)?.name ?? "agent"}` })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  function selectWorker(id: string) {
    setSelected(id);
    requestAnimationFrame(() => {
      if (!window.matchMedia("(max-width: 800px)").matches) return;
      const inspector = document.getElementById("network-inspector");
      inspector?.focus({ preventScroll: true });
      inspector?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
  }
  function openTask(id: string) {
    const task = board.allTasks.find(item => item.id === id);
    if (!task) return;
    if (task.mission_id && task.mission_id !== mission?.id) board.selectMission(task.mission_id);
    setCreating(false);
    setSection("queue");
    board.setQueueTab(tabFor(task));
    board.selectTask(id);
  }
  /** Runs a task action and records its outcome next to the button that triggered it (and as a toast). */
  async function run(key: string, action: () => Promise<Result | string>) {
    setResults(current => { const next = { ...current }; delete next[key]; return next; });
    try {
      const outcome = await action();
      const result: Result = typeof outcome === "string" ? { kind: "ok", text: outcome } : outcome;
      setResults(current => ({ ...current, [key]: result }));
      toast.success(result.text);
    } catch (error) {
      if (isCancelled(error)) return;
      const text = errorText(error);
      const existing = /recovery draft for this task already exists: ([A-Za-z0-9_-]+)/i.exec(text);
      const result: Result = existing ? { kind: "error", text: "A recovery draft already exists.", draftId: existing[1] } : { kind: "error", text };
      setResults(current => ({ ...current, [key]: result }));
      toast.error(result.text);
    }
  }
  function resultLine(key: string): ReactNode {
    const result = results[key];
    if (!result) return null;
    return <p className={`${styles.inlineResult} ${styles[result.kind]}`} role={result.kind === "error" ? "alert" : "status"}>{result.text}{result.draftId && <button onClick={() => openTask(result.draftId!)}>Open the draft</button>}</p>;
  }
  function pendingLabel(key: string, idle: string, busy: string) {
    return board.actionTaskId === key || (key === "approve-all" && board.approving && !board.actionTaskId) ? <><span className={styles.spinner} aria-hidden="true" />{busy}</> : idle;
  }

  function requestLine(task: Task): ReactNode {
    const open = task.orchestrator_request;
    if (!open) return null;
    const state = requestState(open.requested_at, open.claimed_at, open.claimed_by_name, board.now);
    const busy = state.kind === "waiting" || state.kind === "claimed";
    const text = open.kind === "recovery"
      ? state.kind === "waiting" ? "Recovery requested; waiting for the orchestrator…" : state.kind === "claimed" ? `${state.name} is drafting a recovery…` : "No orchestrator online. You can request the recovery again; it stays open meanwhile."
      : state.kind === "waiting" ? "Claude review requested; waiting for the orchestrator…" : state.kind === "claimed" ? `${state.name} is reviewing the PR…` : "No orchestrator online. The rules-only review above stands.";
    return <p className={`${styles.inlineResult} ${busy ? styles.ok : ""}`} role="status">{busy && <span className={styles.spinner} aria-hidden="true" />} {text}</p>;
  }
  function requestBusy(task: Task) {
    const open = task.orchestrator_request;
    if (!open) return false;
    const kind = requestState(open.requested_at, open.claimed_at, open.claimed_by_name, board.now).kind;
    return kind === "waiting" || kind === "claimed";
  }

  function taskPanel(task: Task) {
    const failure = task.status === "failed" ? lastFailure(board, task) : null;
    const recovery = task.status === "failed" ? pendingRecovery(board, task) : null;
    const checksPassed = Boolean(task.checks?.lint && task.checks.typecheck && task.checks.build);
    const confirmed = Boolean(task.head_sha && mergeConfirmed[task.id] === task.head_sha);
    const owner = board.agents.find(agent => agent.id === task.agent_id);
    return <>
      <div className={styles.inspectorHeading}><span>{taskLabels[task.status]}{owner ? ` · ${owner.name}` : ""}</span><code>{task.size} · {task.id.slice(0, 8)}</code></div>
      <h2>{task.title}</h2>
      <p>{task.description}</p>
      <div className={styles.detailSection}><h3>Acceptance</h3><p>{task.acceptance ?? "No acceptance criteria supplied."}</p></div>
      <div className={styles.detailSection}><h3>File scope</h3><ul className={styles.scopeList}>{task.scope.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul><small>{["claimed", "in_progress", "in_review"].includes(task.status) ? task.status === "in_review" ? "Locked until a human marks the merged PR done." : "Locked by this task's active claim." : "No lock held."}</small></div>
      <div className={styles.detailSection}><h3>Dependencies</h3><p>{task.depends_on.length ? task.depends_on.map(id => board.allTasks.find(item => item.id === id)?.title ?? "Task outside this mission").join("; ") : "No prerequisite tasks."}</p></div>
      <TaskEvidence task={task} reviewHeading={reviewHeadingFor(task)} />
      {failure && <div className={styles.detailSection}><h3>Failure reason</h3><p>{failure.reason}</p>{failure.log ? <pre className={styles.failureLog} aria-label="Last lines of the failing check">{failure.log}</pre> : <small>No check log was attached.</small>}</div>}

      {task.status === "draft" && <div className={styles.taskActions}>
        <button className={styles.primary} disabled={acting} aria-busy={board.actionTaskId === task.id} onClick={() => run(task.id, async () => { await board.approveTasks([task.id]); return "Draft approved and added to the queue."; })}>{pendingLabel(task.id, "Approve this task", "Approving…")}</button>
        {resultLine(task.id)}
      </div>}
      {task.status === "in_review" && <div className={styles.taskActions} aria-busy={board.actionTaskId === task.id}>
        <button className={styles.secondary} disabled={acting || !task.pr_url || !task.head_sha || (task.orchestrator_request?.kind === "review" && requestBusy(task))} onClick={() => run(task.id, async () => { const { review, requested } = await board.reviewTask(task.id); return `Review saved: ${review.verdict.replaceAll("_", " ")} at ${review.sha.slice(0, 7)}${review.model === "rules" ? " (rules-only)" : ""}.${requested ? " Claude review requested from the orchestrator." : ""}`; })}>{pendingLabel(task.id, "Review evidence", "Reviewing…")}</button>
        <label className={styles.mergeConfirm}><input type="checkbox" checked={confirmed} disabled={acting || !task.head_sha} onChange={event => setMergeConfirmed(current => ({ ...current, [task.id]: event.target.checked ? task.head_sha! : "" }))} />I merged this PR at <code>{task.head_sha?.slice(0, 7) ?? "—"}</code></label>
        <button className={styles.primary} disabled={acting || !checksPassed || !confirmed} onClick={() => run(task.id, async () => { await board.markDone(task.id); return "Marked done. The scope lock is released."; })}>Mark done after merge</button>
        {task.orchestrator_request?.kind === "review" && requestLine(task)}
        <small>{checksPassed ? "Marking done releases this task's scope lock." : "Lint, types and build must pass before it can be marked done."}</small>
        {resultLine(task.id)}
      </div>}
      {task.status === "failed" && <div className={styles.taskActions} aria-busy={board.actionTaskId === task.id}>
        {recovery
          ? <p className={`${styles.inlineResult} ${styles.ok}`}>Recovery proposed: {recovery.title} · awaiting approval<button onClick={() => openTask(recovery.id)}>Open the draft</button></p>
          : task.orchestrator_request?.kind === "recovery" && requestBusy(task) ? requestLine(task)
          : <button className={styles.secondary} disabled={acting} onClick={() => run(task.id, async () => { const response = await board.recoverTask(task.id); return response.requested ? "Recovery requested from the orchestrator. Its draft appears here for your approval." : { kind: "ok", text: `${response.kind === "fix" ? "Fix" : "Prerequisite"} draft proposed. Review it before approving.`, draftId: response.task_id }; })}>{pendingLabel(task.id, task.orchestrator_request?.kind === "recovery" ? "Request recovery again" : "Propose recovery", "Requesting…")}</button>}
        {!recovery && task.orchestrator_request?.kind === "recovery" && !requestBusy(task) && requestLine(task)}
        <small>Creates one draft for human approval. The failed task stays visible.</small>
        {resultLine(task.id)}
      </div>}
    </>;
  }

  function workerInspector(agent: Agent) {
    const owner = board.participants.find(person => person.id === agent.participant_id);
    const task = assignedTask(agent, board.allTasks);
    const held = board.scopeLocks[agent.id] ?? [];
    return <aside id="network-inspector" tabIndex={-1} className={styles.inspector} aria-label={`${agent.name} details`}>
      <div className={styles.inspectorHeading}><span>{owner?.name ?? "Teammate"} · {toolNames[agent.tool]} {agent.role}</span><code>{agent.id.slice(0, 8)}</code></div>
      <h2>{task?.title ?? agent.name}</h2>
      <div className={styles.inspectorStatus}><WorkerStatus agent={agent} />{task && <span>{taskLabels[task.status]}</span>}</div>
      <dl className={styles.facts}>
        <div><dt>Worker</dt><dd>{agent.name}</dd></div>
        {(agent.machine || agent.model) && <div><dt>Runs on</dt><dd>{[agent.machine, agent.model].filter(Boolean).join(" · ")}</dd></div>}
        <div><dt>Heartbeat</dt><dd className={styles.mono}>{age(agent.last_heartbeat, board.now)}</dd></div>
        <div><dt>Current task</dt><dd>{agent.current_task_id ? task?.title ?? "Assigned task" : task?.status === "in_review" ? "None · its PR is in review" : "No current task"}</dd></div>
      </dl>
      <div className={styles.detailSection}><h3>Latest progress</h3><p>{agent.note ?? "No progress note yet."}</p></div>
      <div className={styles.detailSection}><h3>{held.length ? "Reserved scope" : "Scope"}</h3>{held.length ? <><ul className={styles.scopeList}>{held.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul><small>{task?.status === "in_review" ? "Held until a human merges the PR." : "Reserved by this task's active claim."}</small></> : <p>No scope held.</p>}</div>
      {task && <><TaskEvidence task={task} reviewHeading={reviewHeadingFor(task)} /><button className={styles.secondary} onClick={() => openTask(task.id)}>Open task and actions <ArrowRight size={14} aria-hidden="true" /></button></>}
      {agent.status === "offline" && <p className={styles.footnote}>Offline: its lease expired or it stopped sending heartbeats. Unfinished work is released to the queue on the next claim.</p>}
    </aside>;
  }
  function serverInspector() {
    return <aside id="network-inspector" tabIndex={-1} className={styles.inspector} aria-label="Server details">
      <div className={styles.inspectorHeading}><Server size={20} aria-hidden="true" /><span>Coordination</span><code>SERVER</code></div>
      <h2>AgentHQ server</h2><p>Workers pull eligible work and report progress here. Humans launch the workers on their own laptops with the hq CLI.</p>
      <div className={styles.detailSection}><h3>AI planning inside the server</h3><p>A human requests a plan. The AI proposes scoped drafts, the server validates them, and a human approves the queue.</p></div>
      <div className={styles.detailSection}><h3>Claims follow rules</h3><ul><li>Non-overlapping file scopes</li><li>Completed dependencies</li><li>Workload fairness</li><li>Fenced attempts and leases</li></ul></div>
      <div className={styles.detailSection}><h3>People own the decisions</h3><p>Scope locks stay held through review until a human merges. Reviews are bound to the head SHA; recovery only proposes drafts.</p><button className={styles.secondary} onClick={() => setSection("mission")}>Open mission decisions <ArrowRight size={14} aria-hidden="true" /></button></div>
    </aside>;
  }

  const selectedAgent = board.agents.find(agent => agent.id === selected);
  const header = <header className={`${styles.topbar} bg-hex`}>
    <span className={styles.brand}><AgentHQMark /><span>AgentHQ</span></span>
    <span className={styles.previewLabel}>Mission control</span>
    <div className={styles.topbarEnd}>
      <span className={`${styles.liveBadge} ${board.error ? styles.offlineBadge : ""}`}><i aria-hidden="true" />{board.loading ? "Connecting…" : board.error ? "Connection issue" : "Live"}</span>
      <span className={styles.userMenu}><span>{user?.email}</span><button onClick={async () => { setSignOutError(""); try { await signOut(); } catch { setSignOutError("Could not sign out. Try again."); } }}>Sign out</button></span>
    </div>
  </header>;

  return <main className={`${styles.root} ${styles.orbit} ${styles.live}`}>
    {header}
    <div className={styles.page}>
      {signOutError && <p className={styles.banner} role="alert">{signOutError}</p>}
      {board.error && <div className={styles.banner} role="alert"><p>Couldn&apos;t load live data: {board.error}</p><button className={styles.secondary} onClick={board.retry} disabled={board.loading}><RotateCcw size={14} aria-hidden="true" />{board.loading ? "Retrying…" : "Retry"}</button></div>}
      <header className={styles.missionHeader}>
        <div>
          <div className={styles.titleLine}><h1>{creating ? "New mission" : mission?.title ?? (board.loading ? "Loading missions…" : "No missions yet")}</h1>{!creating && mission && <span className={styles.missionState}><i aria-hidden="true" />{missionLabels[mission.status]}</span>}</div>
          <p>{creating ? "Turn a goal into scoped draft work." : mission ? `${board.agents.length} ${board.agents.length === 1 ? "worker" : "workers"} across ${new Set(board.agents.map(agent => agent.participant_id)).size} teammates · ${tasks.length} tasks` : "Create a mission to get a draft plan."}</p>
          {!creating && board.cachedPlan && <span className={styles.badge}>Cached demo plan · the AI was busy when this mission was planned</span>}
        </div>
        <div className={styles.missionControls}>
          {board.missions.length > 0 && <><label className={styles.srOnly} htmlFor="live-mission">Select mission</label><select id="live-mission" value={mission?.id ?? ""} disabled={acting} onChange={event => { board.selectMission(event.target.value); setSelected("server"); setCreating(false); setResults({}); }}>{board.missions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></>}
          <button className={styles.secondary} disabled={acting || board.loading} onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />New mission</button>
        </div>
      </header>
      <nav className={styles.sectionNav} aria-label="Mission sections">{(["mission", "agents", "queue", "activity"] as const).map(item => <button key={item} disabled={!mission && !creating} aria-current={!creating && section === item ? "page" : undefined} onClick={() => { setSection(item); setCreating(false); }}>{item.charAt(0).toUpperCase() + item.slice(1)}{item === "queue" && board.drafts.length > 0 && <span>{board.drafts.length}</span>}{item === "mission" && decisions.length > 0 && <span>{decisions.length}</span>}</button>)}<span className={styles.navSummary}>{decisions.length} {decisions.length === 1 ? "decision needs" : "decisions need"} attention</span></nav>

      {creating ? <div className={styles.creatorSurface}><MissionCreator mode="live" planning={board.planning} disabled={acting} error={board.planningError} onCancel={() => setCreating(false)} onPlan={async input => { const response = await board.planMission(input); setCreating(false); setSection("queue"); board.setQueueTab("drafts"); setSelected("server"); return response; }} /></div>
        : !mission ? board.loading ? <div className={styles.loadingState} role="status"><span className={styles.spinner} aria-hidden="true" />Connecting to your team&apos;s missions, tasks and workers…</div>
          : <div className={styles.empty}><Server size={30} aria-hidden="true" /><h3>No missions yet</h3><p>Describe a goal and the AI drafts scoped tasks for your team to review.</p><button className={styles.primary} onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />New mission</button></div>
        : mission.status === "planning" ? <PlanningPanel mission={mission} now={board.now} />
        : <>
          {section === "agents" && <div className={styles.workspace}><Network key={mission.id} agents={board.agents} participants={board.participants} tasks={board.allTasks} workload={board.workload} variant="orbit" selected={selected} select={selectWorker} nodeLabel={liveLabel} serverCaption="AI planning · deterministic claims" emptyText="Workers appear here after they run hq join." />{selectedAgent ? workerInspector(selectedAgent) : serverInspector()}</div>}

          {section === "mission" && <section className={styles.missionView} aria-labelledby="mission-overview-heading">
            <div className={styles.missionBrief}><h2 id="mission-overview-heading">The shared goal</h2><p>{mission.goal}</p><ol className={styles.missionFlow}><li><span>Human brief</span><small>A teammate defines the outcome.</small></li><li><span>AI drafts · inside the server</span><small>Plans are requested by humans and validated before approval.</small></li><li><span>Humans approve, workers claim</span><small>The server coordinates scopes, dependencies, fairness and leases.</small></li></ol><button className={styles.secondary} onClick={() => { setSection("agents"); setSelected("server"); }}><Server size={16} aria-hidden="true" />Inspect server rules</button></div>
            <div className={styles.attention}><h2>{decisions.length ? "Your decisions" : "No decisions waiting"}<span>{decisions.length}</span></h2>{decisions.map(item => <button key={item.key} className={styles.decisionRow} onClick={() => item.task ? openTask(item.task.id) : (setSection("agents"), selectWorker(item.key))}><span><small>{item.note}</small><strong>{item.title}</strong><span>{item.description}</span></span><ArrowRight size={18} aria-hidden="true" /></button>)}<div className={styles.draftSummary}><ShieldCheck size={20} aria-hidden="true" /><div><strong>{board.drafts.length} draft {board.drafts.length === 1 ? "task" : "tasks"} awaiting approval</strong><p>Review the scope and dependencies before adding work to the queue.</p><button className={styles.textButton} onClick={() => { setSection("queue"); board.setQueueTab("drafts"); }}>Review drafts <ArrowRight size={14} aria-hidden="true" /></button></div></div></div>
            <div className={styles.workload}><h2>Shared workload</h2><p>Task points · S = 1, M = 2, L = 4. A fairness proxy, not token usage.</p><div>{board.workload.map(person => <article key={person.id}><span>{person.name}</span><strong>{person.points}<small>{person.points === 1 ? "point" : "points"}</small></strong><progress aria-label={`${person.name} workload points`} max={Math.max(4, ...board.workload.map(item => item.points))} value={person.points} /></article>)}</div></div>
          </section>}

          {section === "queue" && <section className={styles.queueView} aria-labelledby="queue-heading">
            <div className={styles.sectionHeading}><div><h2 id="queue-heading">Review the next work</h2><p>Approval adds drafts to the shared queue. Workers claim eligible tasks through the hq CLI.</p></div><div>{board.drafts.length > 0 && <button className={styles.primary} disabled={acting} aria-busy={board.approving && !board.actionTaskId} onClick={() => run("approve-all", async () => { const count = board.drafts.length; await board.approveAll(); return `${count} ${count === 1 ? "draft" : "drafts"} approved and added to the queue.`; })}>{pendingLabel("approve-all", board.drafts.length === 1 ? "Approve 1 draft" : `Approve all ${board.drafts.length} drafts`, "Approving…")}</button>}{resultLine("approve-all")}</div></div>
            <div className={styles.queueTabs} aria-label="Task lists">{queueTabs.map(tab => { const count = tasks.filter(task => tab.statuses.includes(task.status)).length; return <button key={tab.id} aria-pressed={queueTab === tab.id} onClick={() => board.setQueueTab(tab.id)}>{tab.label} <span>{count}</span></button>; })}</div>
            <div className={styles.queueColumns}>
              <div className={styles.taskList}>{rows.length ? rows.map((task, index) => <div key={task.id} className={styles.taskRow}><button className={styles.taskSelect} aria-pressed={activeTask?.id === task.id} onClick={() => board.selectTask(task.id)}><span className={styles.taskOrder}>{String(index + 1).padStart(2, "0")}</span><span><strong>{task.title}</strong><small>{task.size} · {taskLabels[task.status]}{task.depends_on.length ? ` · waits for ${task.depends_on.length}` : ""}{results[task.id]?.kind === "error" ? " · action failed" : ""}</small><code>{task.scope.join(", ") || "No scope specified"}</code></span></button></div>) : <div className={styles.empty}><Check size={26} aria-hidden="true" /><h3>Nothing here</h3><p>{queueTab === "drafts" ? "All drafts are reviewed." : queueTab === "up-next" ? "The queue is clear. Review drafts or create a new mission." : "No tasks in this list yet."}</p></div>}</div>
              <aside className={styles.taskDetail} aria-label="Selected task details">{activeTask ? taskPanel(activeTask) : <p>Select a task to see its scope, evidence and actions.</p>}</aside>
            </div>
          </section>}

          {section === "activity" && <section className={styles.activityView} aria-labelledby="activity-heading"><div className={styles.sectionHeading}><div><h2 id="activity-heading">Mission activity</h2><p>Live events and agent messages for {mission.title}.</p></div></div>{timeline.length ? <ol className={styles.eventList}>{timeline.map(item => <li key={item.id}><time dateTime={item.at}>{age(item.at, board.now)}</time><div><strong>{item.title}</strong><span>{item.meta}</span></div></li>)}</ol> : <div className={styles.empty}><h3>No events for this mission yet</h3><p>Planning, approval and worker events appear here.</p></div>}</section>}
        </>}
      <div className={styles.announcement} role="status" aria-live="polite">{board.announcement}</div>
      <footer className={styles.footer}><span>Live Firestore data</span><span>Workers are launched by humans with the hq CLI. A human merges every PR.</span></footer>
    </div>
  </main>;
}
