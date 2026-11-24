"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Check, Plus, RotateCcw, Server, ShieldCheck } from "lucide-react";
import { AgentHQMark } from "@/components/agenthq-mark";
import { MissionCreator } from "@/components/mission-creator";
import { Network, TaskEvidence as SharedTaskEvidence, WorkerStatus, age, assignedTask, missionLabels, taskLabels, variants, type Variant } from "@/components/network/network-parts";
import { useMockMissionData as useMissionData } from "@/lib/mocks/use-mock-mission-data";
import type { Agent, Task } from "@/types/api";
import styles from "./agent-network-dashboard.module.css";

// Mock reference for the network layout (/lab/network). The live dashboard at / shares its graph parts.
type Board = ReturnType<typeof useMissionData>;
type Section = "mission" | "agents" | "queue" | "activity";
const mockLabel = (agent: Agent) => `Codex ${agent.id.slice(1).padStart(2, "0")}`;
function TaskEvidence({ task }: { task: Task }) { return <SharedTaskEvidence task={task} reviewHeading="Phase 2 · sample review" />; }

function Inspector({ board, selected, decision, setDecision, savedDecision, saveDecision, openMission }: {
  board: Board; selected: string; decision: string; setDecision: (value: string) => void;
  savedDecision: string; saveDecision: () => void; openMission: () => void;
}) {
  const agent = board.agents.find(item => item.id === selected);
  if (!agent) return <aside id="network-inspector" tabIndex={-1} className={styles.inspector} aria-label="Server details">
    <div className={styles.inspectorHeading}><Server size={20} aria-hidden="true" /><span>Coordination</span><code>SERVER</code></div>
    <h2>AgentHQ server</h2><p>Workers pull eligible work and report progress here. Humans launch the workers on their own laptops.</p>
    <div className={styles.detailSection}><h3>Gemini lives inside the server</h3><p>A human requests a plan. Gemini proposes scoped drafts, the server validates them, and a human approves the queue.</p></div>
    <div className={styles.detailSection}><h3>Claims follow rules</h3><ul><li>Non-overlapping file scopes</li><li>Completed dependencies</li><li>Workload fairness</li><li>Fenced attempts and 10-minute leases</li></ul></div>
    <div className={styles.detailSection}><h3>People own the decisions</h3><p>Scope locks remain held through review until a human merges. Review and recovery are Phase 2 mock previews.</p><button className={styles.secondary} onClick={openMission}>Open mission decisions <ArrowRight size={14} aria-hidden="true" /></button></div>
  </aside>;
  const owner = board.participants.find(person => person.id === agent.participant_id);
  const task = assignedTask(agent, board.tasks);
  const held = board.scopeLocks[agent.id] ?? [];
  return <aside id="network-inspector" tabIndex={-1} className={styles.inspector} aria-label={`${agent.name} details`}>
    <div className={styles.inspectorHeading}><span>{owner?.name ?? "Teammate"} · Codex worker</span><code>{agent.id}</code></div>
    <h2>{task?.title ?? agent.name}</h2>
    <div className={styles.inspectorStatus}><WorkerStatus agent={agent} />{task && <span>{task.id} · {taskLabels[task.status]}</span>}</div>
    <dl className={styles.facts}>
      <div><dt>Worker</dt><dd>{agent.name}</dd></div>
      <div><dt>Heartbeat</dt><dd className={styles.mono}>{age(agent.last_heartbeat, board.now)} · sample</dd></div>
      <div><dt>Current task</dt><dd>{agent.current_task_id ? `${agent.current_task_id} · ${task?.title ?? "Assigned task"}` : "No current task"}</dd></div>
      {task?.status === "in_review" && !agent.current_task_id && <div><dt>Submitted work</dt><dd>{task.id} remains in review while this worker is idle.</dd></div>}
    </dl>
    <div className={styles.detailSection}><h3>Latest progress</h3><p>{agent.note ?? "No progress note yet."}</p></div>
    {agent.status === "blocked" && <div className={styles.decisionForm}>
      <label htmlFor="network-decision">Invite expiry decision</label>
      <input id="network-decision" value={decision} onChange={event => setDecision(event.target.value)} placeholder="For example, 7 days" maxLength={160} />
      <button className={styles.primary} onClick={saveDecision} disabled={!decision.trim()}>Record local decision</button>
      {savedDecision && <p role="status">Saved locally: {savedDecision}. The worker remains blocked until the real task is updated.</p>}
    </div>}
    <div className={styles.detailSection}><h3>{held.length ? "Reserved scope" : "Scope"}</h3>{held.length ? <><ul className={styles.scopeList}>{held.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul><small>{task?.status === "in_review" ? "Held until a human merges the PR." : "Reserved by this task’s active claim."}</small></> : <p>No scope held.</p>}</div>
    {task && <TaskEvidence task={task} />}
    {agent.status === "offline" && <p className={styles.footnote}>An expired lease can release unfinished work for another worker. This preview does not simulate a reassignment.</p>}
  </aside>;
}

export function AgentNetworkDashboard() {
  const board = useMissionData();
  const [variant, setVariant] = useState<Variant>("orbit");
  const [section, setSection] = useState<Section>("agents");
  const [selected, setSelected] = useState("a2");
  const [creating, setCreating] = useState(false);
  const [decision, setDecision] = useState("");
  const [savedDecision, setSavedDecision] = useState("");
  const [localNotice, setLocalNotice] = useState("");
  const acting = board.approving || board.planning;
  const decisions = [
    ...board.agents.filter(agent => agent.status === "blocked").map(agent => ({ id: agent.id, title: "Decide invite expiry", note: `${board.participants.find(person => person.id === agent.participant_id)?.name ?? "Teammate"} · blocked`, description: agent.note ?? "The worker needs your decision." })),
    ...board.tasks.filter(task => task.status === "in_review" && (task.review?.verdict === "needs_human" || (task.checks && Object.values(task.checks).some(pass => !pass)))).map(task => ({ id: task.agent_id ?? "server", title: task.title, note: "Build failed · human review", description: "Resolve the submitted checks before merging. The scope remains held." })),
  ];
  const events = board.events.filter(event => event.mission_id === board.mission.id || (event.mission_id === null && event.task_id !== null && board.tasks.some(task => task.id === event.task_id))).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const queueRows = board.queueTab === "drafts" ? board.drafts : board.queue;
  const activeTask = queueRows.find(task => task.id === board.selectedTask?.id) ?? queueRows[0];
  function selectWorker(id: string) {
    setSelected(id);
    setLocalNotice("");
    requestAnimationFrame(() => {
      if (!window.matchMedia("(max-width: 800px)").matches) {
        if (document.activeElement === document.body) document.getElementById(`network-worker-${id}`)?.focus({ preventScroll: true });
        return;
      }
      const inspector = document.getElementById("network-inspector");
      inspector?.focus({ preventScroll: true });
      inspector?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
  }
  function openWorker(id: string) { setCreating(false); setSection("agents"); selectWorker(id); }
  function reset() { board.reset(); setSection("agents"); setSelected("a2"); setVariant("orbit"); setCreating(false); setDecision(""); setSavedDecision(""); setLocalNotice(""); }
  return <main className={`${styles.root} ${styles[variant]}`}>
    <header className={styles.topbar}><Link href="/" className={styles.brand}><AgentHQMark /><span>AgentHQ</span></Link><span className={styles.previewLabel}>Network preview</span><div className={styles.topbarEnd}><span className={styles.mockLabel}><i aria-hidden="true" />Local mock</span><Link href="/">Quiet workspace <ArrowRight size={14} aria-hidden="true" /></Link></div></header>
    <div className={styles.page}>
      <div className={styles.variantToolbar} aria-label="Network compositions"><span>Explore the network</span><div>{variants.map(item => <button key={item.id} onClick={() => setVariant(item.id)} aria-pressed={variant === item.id} title={item.description}>{item.name}</button>)}</div><button className={styles.reset} onClick={reset} disabled={acting}><RotateCcw size={14} aria-hidden="true" /><span>Reset preview</span></button></div>
      <header className={styles.missionHeader}><div><div className={styles.titleLine}><h1>{creating ? "New mission" : board.mission.title}</h1>{!creating && <span className={styles.missionState}><i aria-hidden="true" />{missionLabels[board.mission.status]}</span>}</div><p>{creating ? "Turn a goal into scoped draft work." : `${board.agents.length} workers across ${new Set(board.agents.map(agent => agent.participant_id)).size} teammates · ${variants.find(item => item.id === variant)?.description}`}</p></div><div className={styles.missionControls}><label className={styles.srOnly} htmlFor="network-mission">Select mission</label><select id="network-mission" value={board.mission.id} disabled={acting} onChange={event => { board.selectMission(event.target.value); setSelected("server"); setCreating(false); setSavedDecision(""); setDecision(""); }}>{board.missions.map(mission => <option key={mission.id} value={mission.id}>{mission.title}</option>)}</select><button className={styles.secondary} disabled={acting} onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />New mission</button></div></header>
      <nav className={styles.sectionNav} aria-label="Mission sections">{(["mission", "agents", "queue", "activity"] as const).map(item => <button key={item} disabled={acting} aria-current={!creating && section === item ? "page" : undefined} onClick={() => { setSection(item); setCreating(false); }}>{item.charAt(0).toUpperCase() + item.slice(1)}{item === "queue" && board.drafts.length > 0 && <span>{board.drafts.length}</span>}</button>)}<span className={styles.navSummary}>{decisions.length} {decisions.length === 1 ? "decision" : "decisions"} need attention</span></nav>
      {board.mission.plan_source === "cached_demo" && <p className={styles.provenance}>Saved demo plan · Gemini was unavailable; this mission uses a cached plan.</p>}
      {creating ? <div className={styles.creatorSurface}><MissionCreator planning={board.planning} disabled={acting} error={board.planningError} onCancel={() => setCreating(false)} onPlan={async input => { const response = await board.planMission(input); setCreating(false); setSection("queue"); setSelected("server"); return response; }} /></div> : <>
        {section === "agents" && <div className={styles.workspace}><Network key={`${variant}-${board.mission.id}`} agents={board.agents} participants={board.participants} tasks={board.tasks} workload={board.workload} variant={variant} selected={selected} select={selectWorker} nodeLabel={mockLabel} serverCaption="Gemini planning · deterministic claims" emptyText="Review the draft plan in Queue. Workers appear here when they join the mission." /><Inspector board={board} selected={selected} decision={decision} setDecision={setDecision} savedDecision={savedDecision} saveDecision={() => { setSavedDecision(decision.trim()); setLocalNotice("Decision recorded locally. No task or worker status changed."); }} openMission={() => setSection("mission")} /></div>}
        {section === "mission" && <section className={styles.missionView} aria-labelledby="mission-overview-heading"><div className={styles.missionBrief}><h2 id="mission-overview-heading">The shared goal</h2><p>{board.mission.goal}</p><ol className={styles.missionFlow}><li><span>Human brief</span><small>A teammate defines the outcome.</small></li><li><span>Gemini drafts · inside the server</span><small>Plans are requested by humans and validated before approval.</small></li><li><span>Humans approve, workers claim</span><small>The server coordinates scopes, dependencies, fairness and leases.</small></li></ol><button className={styles.secondary} onClick={() => { setSection("agents"); setSelected("server"); }}><Server size={16} aria-hidden="true" />Inspect server rules</button><p className={styles.footnote}>Phase 2 review and recovery are local mock previews. Workers are launched by humans; a human merges the result.</p></div><div className={styles.attention}><h2>{decisions.length ? "Your decisions" : "No decisions waiting"}<span>{decisions.length}</span></h2>{decisions.map(item => <button key={item.id} className={styles.decisionRow} onClick={() => openWorker(item.id)}><span><small>{item.note}</small><strong>{item.title}</strong><span>{item.description}</span></span><ArrowRight size={18} aria-hidden="true" /></button>)}<div className={styles.draftSummary}><ShieldCheck size={20} aria-hidden="true" /><div><strong>{board.drafts.length} draft {board.drafts.length === 1 ? "task" : "tasks"} awaiting approval</strong><p>Review the scope and dependencies before adding work to the queue.</p><button className={styles.textButton} onClick={() => { setSection("queue"); board.setQueueTab("drafts"); }}>Review drafts <ArrowRight size={14} aria-hidden="true" /></button></div></div></div><div className={styles.workload}><h2>Shared workload</h2><p>Task points · S = 1, M = 2, L = 4. A fairness proxy, not token usage.</p><div>{board.workload.map(person => <article key={person.id}><span>{person.name}</span><strong>{person.points}<small>{person.points === 1 ? "point" : "points"}</small></strong><progress aria-label={`${person.name} workload points`} max={Math.max(4, ...board.workload.map(item => item.points))} value={person.points} /></article>)}</div></div></section>}
        {section === "queue" && <section className={styles.queueView} aria-labelledby="queue-heading"><div className={styles.sectionHeading}><div><h2 id="queue-heading">Review the next work</h2><p>Approval adds drafts to the local queue. Server eligibility rules still apply.</p></div><button className={styles.primary} disabled={acting || !board.drafts.length} onClick={board.approveAll}>{board.approving ? "Approving…" : `Approve all ${board.drafts.length} drafts`}</button></div><div className={styles.queueTabs} aria-label="Task lists"><button aria-pressed={board.queueTab !== "drafts"} onClick={() => board.setQueueTab("up-next")}>Up next <span>{board.queue.length}</span></button><button aria-pressed={board.queueTab === "drafts"} onClick={() => board.setQueueTab("drafts")}>Drafts <span>{board.drafts.length}</span></button></div><div className={styles.queueColumns}><div className={styles.taskList}>{queueRows.length ? queueRows.map((task, index) => <div key={task.id} className={styles.taskRow}><button className={styles.taskSelect} aria-pressed={activeTask?.id === task.id} onClick={() => board.selectTask(task.id)}><span className={styles.taskOrder}>{String(index + 1).padStart(2, "0")}</span><span><strong>{task.title}</strong><small>{task.id} · {task.size} · {taskLabels[task.status]}{task.depends_on.length ? ` · waits for ${task.depends_on.join(", ")}` : ""}</small><code>{task.scope.join(", ") || "No scope specified"}</code></span></button>{board.queueTab !== "drafts" && <div className={styles.reorder}><button disabled={acting || index === 0} onClick={() => board.moveTask(task.id, -1)} aria-label={`Move ${task.title} up`}><ArrowUp size={16} aria-hidden="true" /></button><button disabled={acting || index === queueRows.length - 1} onClick={() => board.moveTask(task.id, 1)} aria-label={`Move ${task.title} down`}><ArrowDown size={16} aria-hidden="true" /></button></div>}</div>) : <div className={styles.empty}><Check size={26} aria-hidden="true" /><h3>{board.queueTab === "drafts" ? "All drafts reviewed" : "The queue is clear"}</h3><p>{board.queueTab === "drafts" ? "Approved tasks are available under Up next." : "Review the drafts or create a new mission."}</p></div>}</div><aside className={styles.taskDetail} aria-label="Selected task details">{activeTask ? <><div className={styles.inspectorHeading}><span>{taskLabels[activeTask.status]}</span><code>{activeTask.id}</code></div><h2>{activeTask.title}</h2><p>{activeTask.description}</p><div className={styles.detailSection}><h3>Acceptance</h3><p>{activeTask.acceptance ?? "No acceptance criteria supplied."}</p></div><div className={styles.detailSection}><h3>File scope</h3><ul className={styles.scopeList}>{activeTask.scope.map(scope => <li key={scope}><code>{scope}</code></li>)}</ul></div><div className={styles.detailSection}><h3>Dependencies</h3><p>{activeTask.depends_on.length ? activeTask.depends_on.map(id => `${id} · ${board.tasks.find(task => task.id === id)?.title ?? "Task outside this mission"}`).join("; ") : "No prerequisite tasks."}</p></div><TaskEvidence task={activeTask} /></> : <p>Select a task to see its scope and acceptance criteria.</p>}</aside></div></section>}
        {section === "activity" && <section className={styles.activityView} aria-labelledby="activity-heading"><div className={styles.sectionHeading}><div><h2 id="activity-heading">Mission activity</h2><p>The latest events for {board.mission.title}. Local sample history.</p></div></div>{events.length ? <ol className={styles.eventList}>{events.map(event => <li key={event.id}><time dateTime={event.created_at}>{age(event.created_at, board.now)}</time><div><strong>{event.message ?? event.type.replaceAll("_", " ")}</strong><span>{event.type.replaceAll("_", " ")}{event.task_id ? ` · ${event.task_id}` : " · mission event"}{event.agent_id ? ` · ${event.agent_id}` : ""}</span></div></li>)}</ol> : <div className={styles.empty}><h3>No events for this mission yet</h3><p>Planning and approval events will appear here.</p></div>}</section>}
      </>}
      <div className={styles.announcement} role="status" aria-live="polite">{localNotice || board.announcement}</div>
      <footer className={styles.footer}><span>{variants.find(item => item.id === variant)?.name} exploration · Local sample data</span><span>No live agents, AI calls or server writes. Review & recovery: Phase 2 mock.</span></footer>
    </div>
  </main>;
}
