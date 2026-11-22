"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, ChevronDown, Eye, FileText, HelpCircle, Loader2, Plus, X } from "lucide-react";
import { AgentHQMark } from "@/components/agenthq-mark";
import { MissionCreator } from "@/components/mission-creator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMissionData } from "@/lib/client/use-mission-data";
import { useFirebaseAuth } from "@/lib/client/auth-provider";
import { TASK_POINTS, type AgentStatus, type MissionStatus, type Task, type TaskStatus } from "@/types/api";
import styles from "@/components/mission-dashboard.module.css";

type View = "attention" | "tasks" | "team" | "activity";
const statusLabels: Record<AgentStatus | TaskStatus, string> = {
  working: "Working", idle: "Idle", blocked: "Blocked", offline: "Offline", draft: "Draft", queued: "Queued",
  claimed: "Claimed", in_progress: "Working", in_review: "In review", done: "Done", failed: "Failed", cancelled: "Cancelled",
};
const missionLabels: Record<MissionStatus, string> = { planning: "Planning", awaiting_approval: "Awaiting approval", running: "Running", reviewing: "Reviewing", done: "Done" };
/** Shown status follows the tasks; the stored field is only a fallback for missions without tasks. */
function derivedMissionStatus(stored: MissionStatus, tasks: Task[]): MissionStatus {
  const counted = tasks.filter(task => task.status !== "cancelled");
  if (!counted.length) return stored;
  if (counted.some(task => task.status === "draft")) return "awaiting_approval";
  if (counted.every(task => task.status === "done")) return "done";
  return "running";
}
function pointsLabel(task: Task) {
  const points = TASK_POINTS[task.size];
  return `${task.size} · ${points} ${points === 1 ? "pt" : "pts"}`;
}
function age(iso: string, now: number) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "Time unavailable";
  if (!now) return "Updating time…";
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function Coordination() {
  return <details className={styles.coordination}>
    <summary>How work is coordinated</summary>
    <ol>
      <li><strong>A human requests a plan.</strong> The server-side Gemini planner turns the mission brief into structured tasks. The server validates file scopes and dependencies before saving drafts. Humans review and approve the plan.</li>
      <li><strong>The server coordinates claims.</strong> Each claim transaction considers priority, dependencies, scope locks, workload fairness and leases.</li>
      <li><strong>Workers pull work through the hq CLI.</strong> Humans launch workers on their own laptops. Workers claim tasks and report progress through the server with their attempt ID.</li>
      <li><strong>Humans review and merge.</strong> Scope locks remain held through PR review. A review is bound to the head SHA and never replaces passing checks or a human merge. Recovery proposes a new draft for approval.</li>
    </ol>
  </details>;
}

export function MissionDashboard() {
  const board = useMissionData();
  const { signOut } = useFirebaseAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [view, setView] = useState<View>("attention");
  const [navOpen, setNavOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [confirmedMerged, setConfirmedMerged] = useState<{ taskId: string; headSha: string } | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<HTMLButtonElement | null>(null);
  const { tasks, agents, mission } = board;
  const reviews = tasks.filter(task => task.status === "in_review");
  const failures = tasks.filter(task => task.status === "failed");
  const blocked = agents.filter(agent => agent.status === "blocked" && board.allTasks.some(task => task.id === agent.current_task_id && task.mission_id === mission?.id && !["in_review", "failed"].includes(task.status)));
  const attentionCount = reviews.length + failures.length + blocked.length;
  const acting = board.approving || board.planning || Boolean(board.actionTaskId) || signingOut;
  const average = board.workload.length ? board.workload.reduce((sum, person) => sum + person.points, 0) / board.workload.length : 0;
  const scale = Math.max(1, ...board.workload.map(person => person.points));
  const timeline = [
    ...board.events.filter(event => mission && (event.mission_id === mission.id || (event.mission_id === null && event.task_id !== null && tasks.some(task => task.id === event.task_id)))).map(event => ({ kind: "event" as const, id: `event-${event.id}`, created_at: event.created_at, event })),
    ...board.messages.filter(message => {
      const task = message.to_task ? board.allTasks.find(task => task.id === message.to_task) : undefined;
      return !task || task.mission_id === mission?.id;
    }).map(message => ({ kind: "message" as const, id: `message-${message.id}`, created_at: message.created_at, message })),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id.localeCompare(b.id));

  useEffect(() => {
    if (!inspectedId) return;
    inspectorRef.current?.focus({ preventScroll: true });
    inspectorRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [inspectedId, view]);
  function focusHeading() { requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true })); }
  function closeInspector() {
    setInspectedId(null);
    setConfirmedMerged(null);
    requestAnimationFrame(() => {
      const origin = originRef.current;
      if (origin?.isConnected && origin.getClientRects().length > 0 && !origin.closest("[hidden], [inert], [aria-hidden=true]") && getComputedStyle(origin).visibility !== "hidden") origin.focus({ preventScroll: true });
      else headingRef.current?.focus({ preventScroll: true });
    });
  }
  function inspect(id: string, trigger?: HTMLButtonElement) {
    if (trigger) originRef.current = trigger;
    board.selectTask(id);
    setConfirmedMerged(null);
    setInspectedId(id);
  }
  function switchMission(id: string) {
    if (acting) return;
    board.selectMission(id);
    setView("attention"); setCreating(false); setInspectedId(null); setConfirmedMerged(null); setNavOpen(false); focusHeading();
  }
  function newMission() { setCreating(true); setInspectedId(null); setNavOpen(false); }
  function dependencyNames(task: Task) { return task.depends_on.map(id => board.allTasks.find(item => item.id === id)?.title ?? id).join(", "); }
  function ownerName(task: Task) {
    const agent = agents.find(item => item.id === task.agent_id);
    return board.participants.find(person => person.id === agent?.participant_id)?.name ?? agent?.name ?? "Unassigned";
  }
  async function runAction(action: () => Promise<unknown> | void) {
    try { await action(); } catch { /* The live adapter exposes the server error without changing Firestore state. */ }
  }
  function taskDetail(task: Task) {
    if (inspectedId !== task.id) return null;
    const agent = agents.find(item => item.id === task.agent_id);
    const held = ["claimed", "in_progress", "in_review"].includes(task.status);
    const reviewIsCurrent = task.review && task.head_sha === task.review.sha;
    const checks = task.checks ? [{ name: "Lint", passed: task.checks.lint }, { name: "TypeScript", passed: task.checks.typecheck }, { name: "Build", passed: task.checks.build }] : [];
    const checksPassed = Boolean(task.checks && task.checks.lint && task.checks.typecheck && task.checks.build);
    const taskPending = board.actionTaskId === task.id;
    return <div id={`task-detail-${task.id}`} className={styles.detail} ref={inspectorRef} tabIndex={-1} aria-labelledby={`detail-heading-${task.id}`}>
      <div className={styles.detailHead}><h3 id={`detail-heading-${task.id}`}>{task.title}</h3><Button variant="ghost" className={styles.control} onClick={closeInspector} aria-label={`Close details for ${task.title}`}><X className="size-4" aria-hidden="true" /><span>Close</span></Button></div>
      {agent?.status === "blocked" && <p className={styles.blockerNote}>{agent.name} is blocked. {agent.note || "The worker has not supplied a reason. Check its task and contact the worker owner."}</p>}
      <p>{task.description}</p>
      {checks.length > 0 ? <div className={styles.checks} aria-label="Reported checks">{checks.map(check => <span key={check.name} className={check.passed ? undefined : styles.failure}>{check.passed ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{check.name} {check.passed ? "passed" : "failed"}</span>)}</div> : <p className={styles.fine}>No check results reported.</p>}
      <dl className={styles.evidence}>
        <div><dt>File scope</dt><dd>{task.scope.length ? task.scope.map(path => <code key={path}>{path}</code>) : "No scope supplied"}</dd></div>
        <div><dt>Scope lock</dt><dd>{held ? task.status === "in_review" ? "Held until merge" : "Reserved for this task" : "No active reservation"}</dd></div>
        <div><dt>Worker</dt><dd>{agent ? `${agent.name} · ${statusLabels[agent.status]}` : "Unassigned"}</dd></div>
        <div><dt>Size</dt><dd>{task.size} · {TASK_POINTS[task.size]} {TASK_POINTS[task.size] === 1 ? "point" : "points"}</dd></div>
        {task.head_sha && <div><dt>Head SHA</dt><dd><code>{task.head_sha}</code></dd></div>}
        {agent && <div><dt>Heartbeat</dt><dd>{age(agent.last_heartbeat, board.now)}</dd></div>}
        {task.lease_expires_at && <div><dt>Lease</dt><dd>{board.now ? new Date(task.lease_expires_at).getTime() > board.now ? "Active · renewed by worker calls" : "Expired · awaiting server reconciliation" : "Updating time…"}</dd></div>}
      </dl>
      <h3>Acceptance criteria</h3><p>{task.acceptance || "No acceptance criteria supplied."}</p>
      {task.depends_on.length > 0 && <><h3>Dependencies</h3><p>{dependencyNames(task)}</p></>}
      {task.result_summary && <><h3>Reported result</h3><p>{task.result_summary}</p></>}
      {task.review && <div className={styles.reviewCopy}><h3>{reviewIsCurrent ? `Review · ${{ pass: "pass", revise: "revision requested", needs_human: "needs human" }[task.review.verdict]}` : "Review · outdated SHA"}</h3><p>{task.review.notes}</p>{task.review.evidence?.length ? <ul className={styles.reviewEvidence}>{task.review.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul> : null}<p className={styles.fine}>Review SHA <code>{task.review.sha}</code>{reviewIsCurrent ? " matches the displayed head." : " does not match the current head; this review is void."} A review never replaces passing checks or a human merge.</p></div>}
      {task.pr_url && <div className={styles.reviewCopy}><h3>Pull request</h3><a href={task.pr_url} target="_blank" rel="noreferrer">Open pull request<ArrowUpRight aria-hidden="true" /></a>{task.branch && <p className={styles.fine}>Branch <code>{task.branch}</code></p>}</div>}
      {task.status === "in_review" && <div className={styles.taskActions} aria-busy={taskPending}>
        <Button variant="outline" className={styles.control} disabled={acting || !task.pr_url || !task.head_sha} onClick={() => runAction(() => board.reviewTask(task.id))}>{taskPending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Review evidence</Button>
        {(!task.pr_url || !task.head_sha) && <p className={styles.fine}>A pull request and head SHA are required for review.</p>}
        <label className={styles.mergeConfirmation}><input type="checkbox" checked={confirmedMerged?.taskId === task.id && confirmedMerged.headSha === task.head_sha} onChange={event => setConfirmedMerged(event.target.checked && task.head_sha ? { taskId: task.id, headSha: task.head_sha } : null)} disabled={acting || !task.pr_url || !task.head_sha || !checksPassed} />I verified that a human merged this pull request.</label>
        <Button className={styles.control} disabled={acting || !checksPassed || !task.pr_url || !task.head_sha || confirmedMerged?.taskId !== task.id || confirmedMerged.headSha !== task.head_sha} onClick={() => runAction(() => board.markDone(task.id))}>Mark done after merge</Button>
        <p className={styles.fine}>{checksPassed ? "Marking done releases this task’s scope lock." : "Passing lint, TypeScript and build results are required before marking done."}</p>
      </div>}
      {task.status === "failed" && <div className={styles.taskActions}><Button variant="outline" className={styles.control} disabled={acting} aria-busy={taskPending} onClick={() => runAction(() => board.recoverTask(task.id))}>{taskPending && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{taskPending ? "Proposing recovery…" : "Propose recovery"}</Button><p className={styles.fine}>Creates a recovery draft for human approval. The failed task remains visible.</p></div>}
      {taskPending && <p role="status" className={styles.hint}>Waiting for the server…</p>}
    </div>;
  }
  function approvalButton() {
    return <Button className={styles.control} onClick={() => runAction(board.approveAll)} disabled={!board.drafts.length || acting} aria-busy={board.approving && !board.actionTaskId}>{board.approving && !board.actionTaskId && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{board.approving && !board.actionTaskId ? "Approving…" : board.drafts.length === 1 ? "Approve 1 task" : `Approve all ${board.drafts.length} tasks`}</Button>;
  }
  function drafts() {
    return <div className={styles.draftList}>{board.drafts.map(task => <details className={styles.draft} key={task.id}><summary><FileText aria-hidden="true" /><span>{task.title}</span><span className={styles.size}>{pointsLabel(task)}</span><ChevronDown className={styles.chevron} aria-hidden="true" /></summary><div className={styles.draftCopy}><p>{task.description}</p><div>File scope {task.scope.map(path => <code key={path}>{path}</code>)}</div><p>Done when: {task.acceptance || "No acceptance criteria supplied."}</p>{task.depends_on.length > 0 && <p>Waits for {dependencyNames(task)}.</p>}<Button variant="outline" className={styles.control} disabled={acting} aria-busy={board.approving && board.actionTaskId === task.id} onClick={() => runAction(() => board.approveTasks([task.id]))}>{board.approving && board.actionTaskId === task.id ? "Approving…" : "Approve this task"}</Button></div></details>)}</div>;
  }
  function personName(email: unknown) {
    if (typeof email !== "string") return null;
    return board.participants.find(person => person.email?.toLowerCase() === email.toLowerCase())?.name ?? email;
  }
  function eventAttribution(event: (typeof board.events)[number]) {
    const approver = event.type === "approved" ? personName(event.data?.by) : null;
    if (approver) return `Approved by ${approver}`;
    if (event.agent_id) return agents.find(agent => agent.id === event.agent_id)?.name ?? `Agent ${event.agent_id}`;
    const actor = personName(event.data?.by);
    return actor ? `By ${actor}` : "Dashboard";
  }
  return <div className={styles.workspace}>
    <aside className={styles.sidebar} data-open={navOpen} aria-label="Workspace navigation">
      <div className={styles.brandRow}><div className={styles.brand}><AgentHQMark aria-hidden="true" />AgentHQ</div><Button variant="outline" className={styles.menuButton} onClick={() => setNavOpen(open => !open)} aria-expanded={navOpen} aria-controls="mission-navigation">Missions<ChevronDown className="size-4" aria-hidden="true" /></Button></div>
      <div className={styles.sideBody} id="mission-navigation"><p className={styles.navLabel}>Missions</p><nav className={styles.missionNav} aria-label="Missions">{board.missions.map(item => <Button variant="ghost" className={styles.missionButton} key={item.id} onClick={() => switchMission(item.id)} disabled={acting} aria-current={!creating && item.id === mission?.id ? "page" : undefined}><FileText aria-hidden="true" /><span>{item.title}</span></Button>)}</nav><Button variant="ghost" className={styles.newMission} onClick={newMission} disabled={acting || board.loading}><Plus className="size-4" aria-hidden="true" />New mission</Button><div className={styles.sideFooter}><p>Shared mission workspace<br />{board.loading ? "Connecting to Firestore…" : board.error ? "Connection needs attention" : "Live Firestore updates"}</p><Button variant="ghost" className={styles.signOutButton} disabled={acting} onClick={async () => { setSigningOut(true); setSignOutError(""); try { await signOut(); } catch { setSignOutError("Could not sign out. Please try again."); } finally { setSigningOut(false); } }}>{signingOut ? "Signing out…" : "Sign out"}</Button>{signOutError && <p className={styles.formError} role="alert">{signOutError}</p>}</div></div>
    </aside>
    <main className={styles.main}><div className={styles.page}>
      {board.error && <div className={styles.connectionError} role="alert"><h2>Couldn’t load the workspace</h2><p>{board.error}</p><Button variant="outline" className={styles.control} onClick={board.retry} disabled={board.loading}>{board.loading ? "Retrying…" : "Retry connection"}</Button></div>}
      {board.actionError && <p role="alert" className={styles.formError}>{board.actionError}</p>}
      {creating ? <MissionCreator mode="live" planning={board.planning} disabled={acting} error={board.planningError} onCancel={() => { setCreating(false); focusHeading(); }} onPlan={async input => { const response = await board.planMission(input); setCreating(false); setView("attention"); setInspectedId(null); focusHeading(); return response; }} /> : (board.loading || board.missionId !== null) && !mission ? <div className={styles.empty} role="status" aria-busy="true"><h1 ref={headingRef} tabIndex={-1}>Loading your workspace…</h1><p>{board.missionId ? "Waiting for the selected mission to arrive from Firestore." : "Connecting to your team’s missions, tasks and workers."}</p><Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /></div> : !mission ? !board.error && <div className={styles.empty}><h1 ref={headingRef} tabIndex={-1}>Your mission workspace</h1><p>Create a mission to turn a goal into scoped draft tasks. Review the plan before approving work for your team.</p><Button className={styles.control} onClick={newMission}><Plus className="size-4" aria-hidden="true" />New mission</Button></div> : <>
        <header className={styles.pageHeader}><div className={styles.titleLine}><h1 ref={headingRef} tabIndex={-1}>{mission.title}</h1><span className={styles.missionState}>{missionLabels[derivedMissionStatus(mission.status, tasks)]}</span></div><p className={styles.goal}>{mission.goal}</p>{(board.cachedPlan || mission.plan_source === "cached_demo") && <p className={styles.cachedPlan}>Cached demo plan · Gemini was unavailable when this plan was created.</p>}{mission.plan_doc_url && <a className={styles.documentLink} href={mission.plan_doc_url} target="_blank" rel="noreferrer">Open plan document<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>}{mission.source_doc_url && <a className={styles.documentLink} href={mission.source_doc_url} target="_blank" rel="noreferrer">Open source brief<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>}</header>
        <Tabs className={styles.viewTabs} value={view} onValueChange={value => { setView(String(value) as View); setInspectedId(null); setConfirmedMerged(null); }}>
          <TabsList variant="line" className={styles.tabList} aria-label="Mission views"><TabsTrigger className={styles.tab} value="attention">Attention<span className={styles.count}>{attentionCount}</span></TabsTrigger><TabsTrigger className={styles.tab} value="tasks">Tasks<span className={styles.count}>{tasks.length}</span></TabsTrigger><TabsTrigger className={styles.tab} value="team">Team<span className={styles.count}>{agents.length}</span></TabsTrigger><TabsTrigger className={styles.tab} value="activity">Activity</TabsTrigger></TabsList>
          <TabsContent value="attention">
            {attentionCount ? <><h2>{attentionCount} {attentionCount === 1 ? "thing needs" : "things need"} your attention</h2><div className={styles.attentionList}>
              {reviews.map(task => <article className={styles.attentionRow} key={task.id}><div className={styles.rowCopy}><Eye aria-hidden="true" /><div><h3>{task.title}</h3><p><span className={task.checks && Object.values(task.checks).some(passed => !passed) ? styles.failure : undefined}>{task.checks && Object.values(task.checks).some(passed => !passed) ? "Reported checks failed" : "Review requested"}</span><span className={styles.separator}>·</span>{ownerName(task)}</p></div></div><Button variant="outline" className={styles.control} onClick={event => inspectedId === task.id ? closeInspector() : inspect(task.id, event.currentTarget)} aria-expanded={inspectedId === task.id} aria-controls={inspectedId === task.id ? `task-detail-${task.id}` : undefined}>Review changes</Button>{taskDetail(task)}</article>)}
              {failures.map(task => <article className={styles.attentionRow} key={task.id}><div className={styles.rowCopy}><HelpCircle aria-hidden="true" /><div><h3>{task.title}</h3><p><span className={styles.failure}>Task failed</span><span className={styles.separator}>·</span>{task.result_summary || "Inspect the reported evidence and propose a recovery draft."}</p></div></div><Button variant="outline" className={styles.control} onClick={event => inspectedId === task.id ? closeInspector() : inspect(task.id, event.currentTarget)} aria-expanded={inspectedId === task.id}>Inspect failure</Button>{taskDetail(task)}</article>)}
              {blocked.map(agent => { const task = tasks.find(item => item.id === agent.current_task_id); return <article className={styles.attentionRow} key={agent.id}><div className={styles.rowCopy}><HelpCircle aria-hidden="true" /><div><h3>{agent.name} is blocked</h3><p>{agent.note || (task ? `Needs help with ${task.title}.` : "The worker has not supplied a reason.")}</p></div></div>{task && <Button variant="outline" className={styles.control} onClick={event => inspectedId === task.id ? closeInspector() : inspect(task.id, event.currentTarget)} aria-expanded={inspectedId === task.id}>Inspect task</Button>}{task && taskDetail(task)}</article>; })}
            </div></> : <div className={styles.empty}><h2>No decisions waiting on you</h2><p>{board.drafts.length ? "Review the draft tasks below before they enter the queue." : "Open Tasks to see the queue, or start a new mission."}</p>{!board.drafts.length && <Button variant="outline" className={styles.control} onClick={newMission}>New mission</Button>}</div>}
            {board.drafts.length > 0 ? <section className={styles.readiness}><div className={styles.sectionHead}><div><h2>{board.drafts.length} {board.drafts.length === 1 ? "draft ready" : "drafts ready"} for approval</h2><p>Adds these tasks to the shared queue.</p></div>{approvalButton()}</div>{drafts()}</section> : board.queue.length > 0 && <div className={styles.queueNote}><p>{board.queue.length} {board.queue.length === 1 ? "task is" : "tasks are"} queued. Workers claim eligible work through the hq CLI.</p><Button variant="outline" className={styles.control} onClick={() => setView("tasks")}>View queue</Button></div>}
          </TabsContent>
          <TabsContent value="tasks">
            {tasks.length === 0 && <div className={styles.empty}><h2>No tasks yet</h2><p>This mission has no tasks. Start a new mission to request a draft plan.</p><Button variant="outline" className={styles.control} onClick={newMission}>New mission</Button></div>}
            {([{ title: "Queued", items: board.queue }, { title: "Drafts", items: board.drafts }, { title: "In progress", items: tasks.filter(task => ["claimed", "in_progress"].includes(task.status)) }, { title: "In review", items: reviews }, { title: "Other outcomes", items: tasks.filter(task => ["done", "cancelled", "failed"].includes(task.status)) }]).filter(group => group.items.length).map(group => <section className={styles.taskSection} key={group.title}><div className={styles.sectionHead}><h2>{group.title} <span className={styles.count}>{group.items.length}</span></h2>{group.title === "Drafts" && approvalButton()}</div>{group.title === "Queued" && <p className={styles.hint}>Priority runs top to bottom. Dependencies and scope locks determine which tasks can be claimed.</p>}{group.items.map((task, index) => <article className={styles.taskRow} key={task.id}><div><button className={styles.taskTitle} onClick={event => inspectedId === task.id ? closeInspector() : inspect(task.id, event.currentTarget)} aria-expanded={inspectedId === task.id}>{group.title === "Queued" && <span className={styles.order}>{index + 1}</span>}{task.title}</button><p>{task.scope.join(", ") || "No scope supplied"}</p>{task.depends_on.length > 0 && <p>Waits for {dependencyNames(task)}.</p>}</div><span className={styles.taskState}><span className={styles.size}>{pointsLabel(task)}</span> {statusLabels[task.status]}</span>{taskDetail(task)}</article>)}</section>)}
          </TabsContent>
          <TabsContent value="team">
            {agents.length ? <><h2>{agents.length} {agents.length === 1 ? "worker has" : "workers have"} joined the team</h2><p className={styles.intro}>{agents.filter(agent => agent.status === "working").length} working · {agents.filter(agent => agent.status === "idle").length} idle · {agents.filter(agent => agent.status === "blocked").length} blocked · {agents.filter(agent => agent.status === "offline").length} offline. Team workers and workload span all missions.</p>
              {agents.map(agent => { const person = board.participants.find(person => person.id === agent.participant_id); const currentTask = board.allTasks.find(task => task.id === agent.current_task_id); const heldScopes = board.scopeLocks[agent.id] ?? []; const reviewTask = board.allTasks.find(task => task.agent_id === agent.id && task.status === "in_review"); const inspectableTask = [currentTask, reviewTask].find(task => task && task.mission_id === mission.id); return <details className={styles.worker} key={agent.id}><summary><span><span className={styles.workerName}>{agent.name}</span><span className={styles.owner}>{person?.name ?? "No participant linked"}</span></span><span className={agent.status === "blocked" ? styles.failure : styles.workerState}>{statusLabels[agent.status]}</span></summary><div className={styles.workerCopy}>{agent.note && <p>{agent.note}</p>}<p>{[agent.tool, agent.model, agent.machine].filter(Boolean).join(" · ")}</p><p>Heartbeat <span className={styles.numeric}>{age(agent.last_heartbeat, board.now)}</span></p>{currentTask && <p>Task: {currentTask.title}</p>}{heldScopes.length ? <><p>{reviewTask ? "Scope held through review until a human merge is marked done." : "Scope reserved for active work."}</p>{heldScopes.map(path => <code key={path}>{path}</code>)}</> : <p>No active file-scope lock.</p>}{inspectableTask && <Button variant="ghost" className={styles.control} onClick={event => { setView("tasks"); inspect(inspectableTask.id, event.currentTarget); }}>Inspect {inspectableTask.title}</Button>}</div></details>; })}
            </> : <div className={styles.empty}><h2>No workers have joined yet</h2><p>Humans launch workers on their laptops and join the team through the hq CLI. Joined workers appear here live.</p></div>}
            {board.workload.length > 0 && <details className={styles.workload}><summary>Team workload balance</summary><div className={styles.balance}><p>Server-recorded workload points across all missions · S = 1, M = 2, L = 4. Points stand in for effort; token usage is not tracked.</p><p>Team average <strong className={styles.numeric}>{average.toFixed(1)} points</strong></p>{board.workload.map(person => <div className={styles.balanceRow} key={person.id}><span>{person.name}</span><div className={styles.bar} role="meter" aria-label={`${person.name} workload`} aria-valuemin={0} aria-valuemax={scale} aria-valuenow={person.points} aria-valuetext={`${person.points} points; team average ${average.toFixed(1)}`}><span className={styles.barFill} style={{ width: `${person.points / scale * 100}%` }} /><span className={styles.averageMarker} style={{ left: `${average / scale * 100}%` }} aria-hidden="true" /></div><b className={styles.numeric}>{person.points} pts</b></div>)}<p>Each vertical marker shows the same team average.</p></div></details>}
          </TabsContent>
          <TabsContent value="activity"><h2>Mission activity</h2><p className={styles.intro}>Events and worker messages in chronological order. Messages without a known mission task are labeled Team message.</p>{timeline.length ? timeline.map(item => {
            if (item.kind === "message") {
              const message = item.message;
              const task = message.to_task ? board.allTasks.find(task => task.id === message.to_task) : undefined;
              const sender = message.from_name || agents.find(agent => agent.id === message.from_agent)?.name || message.from_agent;
              const recipient = agents.find(agent => agent.id === message.to_agent)?.name || message.to_agent;
              return <article className={styles.event} key={item.id}><div><p className={styles.messageText}>{message.text}</p><small>{sender} → {recipient} · {task?.title ?? "Team message"}</small>{task?.mission_id === mission.id && <Button variant="ghost" className={`${styles.control} mt-2`} onClick={event => { setView("tasks"); inspect(task.id, event.currentTarget); }}>Inspect task</Button>}</div><time dateTime={message.created_at} className={styles.numeric}>{age(message.created_at, board.now)}</time></article>;
            }
            const event = item.event;
            const task = event.task_id ? board.allTasks.find(task => task.id === event.task_id) : undefined;
            return <article className={styles.event} key={item.id}><div><p>{event.message ?? event.type.replaceAll("_", " ")}</p><small>{task?.title ?? "Mission event"} · {eventAttribution(event)}</small>{task?.mission_id === mission.id && <Button variant="ghost" className={`${styles.control} mt-2`} onClick={clickEvent => { setView("tasks"); inspect(task.id, clickEvent.currentTarget); }}>Inspect task</Button>}</div><time dateTime={event.created_at} className={styles.numeric}>{age(event.created_at, board.now)}</time></article>;
          }) : <div className={styles.empty}><p>No history for this mission yet.</p><Button variant="outline" className={styles.control} onClick={() => setView("attention")}>View attention</Button></div>}</TabsContent>
        </Tabs>
        <Coordination />
      </>}
    </div></main>
    <div className={styles.announcement} role="status" aria-live="polite" aria-atomic="true">{board.announcement}</div>
  </div>;
}
