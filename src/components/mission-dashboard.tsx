"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronDown, Eye, FileText, HelpCircle, Loader2, Plus, RotateCcw, X } from "lucide-react";
import { AgentHQMark } from "@/components/agenthq-mark";
import { MissionCreator } from "@/components/mission-creator";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMissionData } from "@/lib/client/use-mission-data";
import { taskPoints } from "@/lib/mocks/mission";
import type { AgentStatus, MissionStatus, Task, TaskStatus } from "@/types/api";
import styles from "@/components/mission-dashboard.module.css";

type View = "attention" | "tasks" | "team" | "activity";
const statusLabels: Record<AgentStatus | TaskStatus, string> = {
  working: "Working", idle: "Idle", blocked: "Blocked", offline: "Offline", draft: "Draft", queued: "Queued",
  claimed: "Claimed", in_progress: "Working", in_review: "In review", done: "Done", failed: "Failed", cancelled: "Cancelled",
};
const missionLabels: Record<MissionStatus, string> = { planning: "Planning", awaiting_approval: "Awaiting approval", running: "Running", reviewing: "Reviewing", done: "Done" };
function age(iso: string, now: number) {
  if (!now) return "Awaiting clock";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}

function Coordination() {
  return <details className={styles.coordination}>
    <summary>How work is coordinated</summary>
    <ol>
      <li><strong>A human requests a plan.</strong> The server-side Gemini planner turns the mission brief into structured JSON. The server validates file scopes, dependencies and task shape before saving drafts. Humans review and approve the plan.</li>
      <li><strong>The server dispatches work deterministically.</strong> A claim transaction considers queue priority, dependencies, scope locks, workload fairness and leases. The planner does not directly assign work to laptops.</li>
      <li><strong>Workers pull work through the hq CLI.</strong> Humans launch workers on their own laptops. Each worker claims and reports through the server with its attempt ID; workers do not connect directly to other laptops.</li>
      <li><strong>Humans review and merge.</strong> A task keeps its scope while its PR is in review. Passing checks and a human merge remain required. The Phase 2 reviewer is bound to a head SHA; recovery proposes new drafts for approval.</li>
    </ol>
    <p>This screen currently uses a local mock adapter. Planning, approval and queue changes do not call Gemini, dispatch workers or write to a live service.</p>
  </details>;
}

export function MissionDashboard() {
  const board = useMissionData();
  const [view, setView] = useState<View>("attention");
  const [navOpen, setNavOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [expiryDecisions, setExpiryDecisions] = useState<Record<string, string>>({});
  const [localAnnouncement, setLocalAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<HTMLButtonElement | null>(null);
  const { tasks, agents } = board;
  const reviews = tasks.filter(task => task.status === "in_review");
  const blocked = agents.filter(agent => agent.status === "blocked");
  const waitingBlocked = blocked.filter(agent => !expiryDecisions[agent.id]);
  const attentionCount = reviews.length + waitingBlocked.length;
  const acting = board.approving || board.planning;
  const average = board.workload.length ? board.workload.reduce((sum, person) => sum + person.points, 0) / board.workload.length : 0;
  const scale = Math.max(1, ...board.workload.map(person => person.points));
  const events = board.events.filter(event => event.mission_id === board.mission.id || (event.mission_id === null && event.task_id !== null && tasks.some(task => task.id === event.task_id)));
  useEffect(() => {
    if (!inspectedId) return;
    inspectorRef.current?.focus({ preventScroll: true });
    inspectorRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [inspectedId, view]);
  function focusHeading() { requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true })); }
  function closeInspector() {
    setInspectedId(null);
    requestAnimationFrame(() => {
      const origin = originRef.current;
      if (origin?.isConnected && origin.getClientRects().length > 0 && !origin.closest("[hidden], [inert], [aria-hidden=true]") && getComputedStyle(origin).visibility !== "hidden") origin.focus({ preventScroll: true });
      else headingRef.current?.focus({ preventScroll: true });
    });
  }
  function inspect(id: string, trigger?: HTMLButtonElement) {
    if (trigger) originRef.current = trigger;
    board.selectTask(id);
    setInspectedId(id);
  }
  function switchMission(id: string) {
    if (acting) return;
    board.selectMission(id);
    setView("attention"); setCreating(false); setInspectedId(null); setNavOpen(false); focusHeading();
  }
  function newMission() { setCreating(true); setInspectedId(null); setNavOpen(false); }
  function reset() {
    board.reset(); setExpiryDecisions({}); setLocalAnnouncement(""); setView("attention"); setCreating(false); setInspectedId(null); setNavOpen(false); focusHeading();
  }
  function dependencyNames(task: Task) { return task.depends_on.map(id => tasks.find(item => item.id === id)?.title ?? id).join(", "); }
  function ownerName(task: Task) {
    const agent = agents.find(item => item.id === task.agent_id);
    return board.participants.find(person => person.id === agent?.participant_id)?.name ?? "Team";
  }
  function taskDetail(task: Task) {
    if (inspectedId !== task.id) return null;
    const agent = agents.find(item => item.id === task.agent_id);
    const isBlocked = agent?.status === "blocked";
    const held = ["claimed", "in_progress", "in_review"].includes(task.status);
    const reviewIsCurrent = task.review && task.head_sha === task.review.sha;
    const checks = task.checks ? [{ name: "Lint", passed: task.checks.lint }, { name: "TypeScript", passed: task.checks.typecheck }, { name: "Build", passed: task.checks.build }] : [];
    return <div id={`task-detail-${task.id}`} className={styles.detail} ref={inspectorRef} tabIndex={-1} aria-labelledby={`detail-heading-${task.id}`}>
      <div className={styles.detailHead}><h3 id={`detail-heading-${task.id}`}>{isBlocked ? "Invite expiry decision" : task.title}</h3><Button variant="ghost" className={styles.control} onClick={closeInspector} aria-label={`Close details for ${task.title}`}><X className="size-4" aria-hidden="true" /><span>Close</span></Button></div>
      {isBlocked && <><p className={styles.blockerNote}>{ownerName(task)}’s {agent.name} needs an invite-expiry rule to continue. A local answer does not update the worker or endpoint.</p>{expiryDecisions[agent.id] ? <p>Recorded locally: {expiryDecisions[agent.id]}. The worker remains Blocked until an actual update.</p> : <form className={styles.expiryForm} onSubmit={event => {
        event.preventDefault();
        const expiry = String(new FormData(event.currentTarget).get("expiry") ?? "");
        if (!["24 hours", "7 days", "30 days"].includes(expiry)) return;
        setExpiryDecisions(current => ({ ...current, [agent.id]: expiry }));
        setLocalAnnouncement(`Invite expiry recorded locally: ${expiry}. ${agent.name} remains Blocked; no worker or endpoint changed.`);
        setInspectedId(null); focusHeading();
      }}><label htmlFor={`invite-expiry-${agent.id}`}>Invite expiry</label><select id={`invite-expiry-${agent.id}`} name="expiry" required defaultValue=""><option value="" disabled>Choose a validity window</option><option value="24 hours">24 hours</option><option value="7 days">7 days</option><option value="30 days">30 days</option></select><Button type="submit" variant="outline" className={styles.control}>Record decision (mock)</Button><p className={styles.fine}>Saved in this page only. The worker remains Blocked until an actual update.</p></form>}</>}
      <p>{task.description}</p>
      {checks.length > 0 && <div className={styles.checks} aria-label="Reported checks">{checks.map(check => <span key={check.name} className={check.passed ? undefined : styles.failure}>{check.passed ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}{check.name} {check.passed ? "passed" : "failed"}</span>)}</div>}
      <dl className={styles.evidence}>
        <div><dt>File scope</dt><dd>{task.scope.length ? task.scope.map(path => <code key={path}>{path}</code>) : "No scope supplied"}</dd></div>
        <div><dt>Scope lock</dt><dd>{held ? task.status === "in_review" ? "Held until merge" : "Reserved for this task" : "No active reservation"}</dd></div>
        <div><dt>Worker</dt><dd>{agent ? `${agent.name} · ${statusLabels[agent.status]}` : "Unassigned"}</dd></div>
        <div><dt>Size</dt><dd>{task.size} · {taskPoints[task.size]} {taskPoints[task.size] === 1 ? "point" : "points"}</dd></div>
        {task.head_sha && <div><dt>Head SHA</dt><dd><code>{task.head_sha}</code></dd></div>}
        {agent && <div><dt>Heartbeat</dt><dd>{age(agent.last_heartbeat, board.now)}</dd></div>}
        {task.lease_expires_at && <div><dt>Lease</dt><dd>{board.now ? new Date(task.lease_expires_at).getTime() > board.now ? "Active · 10-minute heartbeat renewal" : "Expired in this fixture" : "Awaiting clock"}</dd></div>}
      </dl>
      <h3>Acceptance criteria</h3><p>{task.acceptance || "No acceptance criteria supplied."}</p>
      {task.depends_on.length > 0 && <><h3>Dependencies</h3><p>{dependencyNames(task)}</p></>}
      {task.review && <div className={styles.reviewCopy}><h3>{reviewIsCurrent ? `Mock review · ${{ pass: "pass", revise: "revision requested", needs_human: "needs human" }[task.review.verdict]}` : "Mock review · outdated SHA"}</h3><p>{task.review.notes}</p><p className={styles.fine}>Review SHA <code>{task.review.sha}</code>{reviewIsCurrent ? " matches the displayed head." : " does not match the current head; this review is void."} A review never replaces passing checks or a human merge.</p></div>}
      {task.pr_url && <div className={styles.reviewCopy}><h3>Mock pull request</h3><p className={styles.fine}>This fixture links to the repository PR list, not a numbered pull request.</p><a href={task.pr_url} target="_blank" rel="noreferrer">Open repository pull requests<ArrowUpRight aria-hidden="true" /></a>{task.branch && <p className={styles.fine}>Branch <code>{task.branch}</code></p>}</div>}
      {task.created_by === "mock-planner" && <p className={styles.fine}>Local fixture plan. These file scopes are illustrative; no Gemini request was sent.</p>}
    </div>;
  }
  function approvalButton() {
    return <Button className={styles.control} onClick={board.approveAll} disabled={!board.drafts.length || acting} aria-busy={board.approving}>{board.approving && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{board.approving ? "Approving…" : `Approve ${board.drafts.length} ${board.drafts.length === 1 ? "task" : "tasks"}`}</Button>;
  }
  function drafts() {
    return <div className={styles.draftList}>{board.drafts.map(task => <details className={styles.draft} key={task.id}><summary><FileText aria-hidden="true" /><span>{task.title}</span><span className={styles.size}>{task.size}</span><ChevronDown className={styles.chevron} aria-hidden="true" /></summary><div className={styles.draftCopy}><p>{task.description}</p><p>File scope {task.scope.map(path => <code key={path}>{path}</code>)}</p><p>Done when: {task.acceptance || "No acceptance criteria supplied."}</p>{task.depends_on.length > 0 && <p>Waits for {dependencyNames(task)}.</p>}{task.created_by === "mock-planner" && <p>Local fixture draft; generated scopes are illustrative.</p>}</div></details>)}</div>;
  }
  return <div className={styles.workspace}>
    <aside className={styles.sidebar} data-open={navOpen} aria-label="Workspace navigation">
      <div className={styles.brandRow}><div className={styles.brand}><AgentHQMark aria-hidden="true" />AgentHQ</div><Button variant="outline" className={styles.menuButton} onClick={() => setNavOpen(open => !open)} aria-expanded={navOpen} aria-controls="mission-navigation">Missions<ChevronDown className="size-4" aria-hidden="true" /></Button></div>
      <div className={styles.sideBody} id="mission-navigation"><p className={styles.navLabel}>Missions</p><nav className={styles.missionNav} aria-label="Missions">{board.missions.map(mission => <Button variant="ghost" className={styles.missionButton} key={mission.id} onClick={() => switchMission(mission.id)} disabled={acting} aria-current={!creating && mission.id === board.mission.id ? "page" : undefined}><FileText aria-hidden="true" /><span>{mission.title}</span></Button>)}</nav><Button variant="ghost" className={styles.newMission} onClick={newMission} disabled={acting}><Plus className="size-4" aria-hidden="true" />New mission</Button><div className={styles.sideFooter}><p>Local mock workspace<br />No live agents or AI calls.</p><Button variant="ghost" className={styles.resetButton} onClick={reset} disabled={acting}><RotateCcw className="size-4" aria-hidden="true" />Reset preview</Button></div></div>
    </aside>
    <main className={styles.main}><div className={styles.page}>
      {creating ? <MissionCreator planning={board.planning} disabled={acting} error={board.planningError} onCancel={() => { setCreating(false); focusHeading(); }} onPlan={async input => { const response = await board.planMission(input); setCreating(false); setView("attention"); setInspectedId(null); focusHeading(); return response; }} /> : <>
        <header className={styles.pageHeader}><div className={styles.titleLine}><h1 ref={headingRef} tabIndex={-1}>{board.mission.title}</h1><span className={styles.missionState}>{missionLabels[board.mission.status]}</span></div><p className={styles.goal}>{board.mission.goal}</p>{board.mission.plan_source === "cached_demo" && <p className={styles.hint}>Cached demo plan · not a live Gemini plan.</p>}</header>
        <Tabs className={styles.viewTabs} value={view} onValueChange={value => { setView(String(value) as View); setInspectedId(null); }}>
          <TabsList variant="line" className={styles.tabList} aria-label="Mission views"><TabsTrigger className={styles.tab} value="attention">Attention<span className={styles.count}>{attentionCount}</span></TabsTrigger><TabsTrigger className={styles.tab} value="tasks">Tasks<span className={styles.count}>{tasks.length}</span></TabsTrigger><TabsTrigger className={styles.tab} value="team">Team<span className={styles.count}>{agents.length}</span></TabsTrigger><TabsTrigger className={styles.tab} value="activity">Activity</TabsTrigger></TabsList>
          <TabsContent value="attention">
            {attentionCount ? <><h2>{attentionCount} {attentionCount === 1 ? "thing needs" : "things need"} your attention</h2><div className={styles.attentionList}>
              {reviews.map(task => <article className={styles.attentionRow} key={task.id}><div className={styles.rowCopy}><Eye aria-hidden="true" /><div><h3>{task.title}</h3><p><span className={task.checks?.build === false ? styles.failure : undefined}>{task.checks?.build === false ? "Build failed" : "Review requested"}</span><span className={styles.separator}>·</span>{ownerName(task)} submitted the changes.</p></div></div><Button variant="outline" className={styles.control} onClick={event => inspectedId === task.id ? closeInspector() : inspect(task.id, event.currentTarget)} aria-expanded={inspectedId === task.id} aria-controls={inspectedId === task.id ? `task-detail-${task.id}` : undefined}>Review changes</Button>{taskDetail(task)}</article>)}
              {waitingBlocked.map(agent => { const task = tasks.find(item => item.id === agent.current_task_id); const owner = board.participants.find(person => person.id === agent.participant_id)?.name ?? "A teammate"; return <article className={styles.attentionRow} key={agent.id}><div className={styles.rowCopy}><HelpCircle aria-hidden="true" /><div><h3>How long should an invite stay valid?</h3><p>{owner}’s <span className="text-foreground">{agent.name}</span> is blocked until you decide.</p></div></div>{task && <Button variant="outline" className={styles.control} onClick={event => inspectedId === task.id ? closeInspector() : inspect(task.id, event.currentTarget)} aria-expanded={inspectedId === task.id} aria-controls={inspectedId === task.id ? `task-detail-${task.id}` : undefined}>Unblock worker</Button>}{task && taskDetail(task)}</article>; })}
            </div></> : <div className={styles.empty}><h2>No decisions waiting on you</h2><p>{board.drafts.length ? "Review the draft tasks below before they enter the queue." : "Open Tasks to see the queue, or start a new mission."}</p>{!board.drafts.length && <Button variant="outline" className={styles.control} onClick={newMission}>New mission</Button>}</div>}
            {board.drafts.length > 0 ? <section className={styles.readiness}><div className={styles.sectionHead}><div><h2>{board.drafts.length} {board.drafts.length === 1 ? "draft ready" : "drafts ready"} for approval</h2><p>Adds these tasks to the queue.</p></div>{approvalButton()}</div>{drafts()}</section> : board.queue.length > 0 && <div className={styles.queueNote}><p>{board.queue.length} {board.queue.length === 1 ? "task is" : "tasks are"} queued. Local approval does not start workers.</p><Button variant="outline" className={styles.control} onClick={() => setView("tasks")}>View queue</Button></div>}
            {blocked.some(agent => expiryDecisions[agent.id]) && <p className={styles.hint}>{blocked.filter(agent => expiryDecisions[agent.id]).map(agent => `${agent.name}: invite expiry recorded locally as ${expiryDecisions[agent.id]}. Worker remains Blocked.`).join(" ")}</p>}<p className={styles.belowNote}>Local mock. Approvals and ordering stay in this browser session. Reset preview restores the starting state.</p>
          </TabsContent>
          <TabsContent value="tasks">
            {tasks.length === 0 && <div className={styles.empty}><h2>No tasks yet</h2><p>Start with a mission goal to create draft work.</p><Button variant="outline" className={styles.control} onClick={newMission}>New mission</Button></div>}
            {([{ title: "Queued", items: board.queue }, { title: "Drafts", items: board.drafts }, { title: "In progress", items: tasks.filter(task => ["claimed", "in_progress"].includes(task.status)) }, { title: "In review", items: reviews }, { title: "Other outcomes", items: tasks.filter(task => ["done", "cancelled", "failed"].includes(task.status)) }]).filter(group => group.items.length).map(group => <section className={styles.taskSection} key={group.title}><div className={styles.sectionHead}><h2>{group.title} <span className={styles.count}>{group.items.length}</span></h2>{group.title === "Drafts" && approvalButton()}</div>{group.title === "Queued" && <p className={styles.hint}>Priority runs top to bottom. Ordering changes this local queue only.</p>}{group.items.map((task, index) => <article className={styles.taskRow} key={task.id}><div><button className={styles.taskTitle} onClick={event => inspectedId === task.id ? closeInspector() : inspect(task.id, event.currentTarget)} aria-expanded={inspectedId === task.id}>{group.title === "Queued" && <span className={styles.order}>{index + 1}</span>}{task.title}</button><p>{task.scope.join(", ")}</p>{task.depends_on.length > 0 && <p>Waits for {dependencyNames(task)}.</p>}</div>{group.title === "Queued" ? <div className={styles.reorder}><Button variant="ghost" className={styles.reorderButton} aria-label={`Move ${task.title} up`} disabled={index === 0 || acting} onClick={() => board.moveTask(task.id, -1)}><ArrowUp aria-hidden="true" /></Button><Button variant="ghost" className={styles.reorderButton} aria-label={`Move ${task.title} down`} disabled={index === group.items.length - 1 || acting} onClick={() => board.moveTask(task.id, 1)}><ArrowDown aria-hidden="true" /></Button></div> : <span className={styles.taskState}>{statusLabels[task.status]}</span>}{taskDetail(task)}</article>)}</section>)}
          </TabsContent>
          <TabsContent value="team">
            {agents.length ? <><h2>Six workers, one shared mission</h2><p className={styles.intro}>{agents.filter(agent => agent.status === "working").length} working · {agents.filter(agent => agent.status === "idle").length} idle · {agents.filter(agent => agent.status === "blocked").length} blocked · {agents.filter(agent => agent.status === "offline").length} offline. Open a worker for its scope and note.</p>
              {agents.map(agent => { const person = board.participants.find(person => person.id === agent.participant_id); const currentTask = tasks.find(task => task.id === agent.current_task_id); const heldScopes = board.scopeLocks[agent.id] ?? []; const reviewTask = tasks.find(task => task.agent_id === agent.id && task.status === "in_review"); return <details className={styles.worker} key={agent.id}><summary><span><span className={styles.workerName}>{agent.name}</span><span className={styles.owner}>{person?.name}</span></span><span className={agent.status === "blocked" ? styles.failure : styles.workerState}>{statusLabels[agent.status]}</span></summary><div className={styles.workerCopy}><p>{agent.note}</p>{expiryDecisions[agent.id] && <p>Invite expiry recorded locally: {expiryDecisions[agent.id]}. The worker remains Blocked until an actual update.</p>}<p>{agent.tool} · {agent.machine}</p><p>Heartbeat <span className={styles.numeric}>{age(agent.last_heartbeat, board.now)}</span></p>{heldScopes.length ? <><p>{reviewTask ? "Scope held until merge, even while this worker is idle." : "Scope reserved for the active task."}</p>{heldScopes.map(path => <code key={path}>{path}</code>)}</> : <p>No active file-scope lock.</p>}{(currentTask || reviewTask) && <Button variant="ghost" className={styles.control} onClick={event => { setView("tasks"); inspect((currentTask ?? reviewTask)!.id, event.currentTarget); }}>Inspect {currentTask?.title ?? reviewTask?.title}</Button>}</div></details>; })}
              <details className={styles.workload}><summary>Workload balance</summary><div className={styles.balance}><p>Assigned work and completed tasks · S = 1, M = 2, L = 4 points. Points stand in for effort; token usage is not tracked.</p><p>Team average <strong className={styles.numeric}>{average.toFixed(1)} points</strong></p>{board.workload.map(person => <div className={styles.balanceRow} key={person.id}><span>{person.name}</span><div className={styles.bar} role="meter" aria-label={`${person.name} workload`} aria-valuemin={0} aria-valuemax={scale} aria-valuenow={person.points} aria-valuetext={`${person.points} points; team average ${average.toFixed(1)}`}><span className={styles.barFill} style={{ width: `${person.points / scale * 100}%` }} /><span className={styles.averageMarker} style={{ left: `${average / scale * 100}%` }} aria-hidden="true" /></div><b className={styles.numeric}>{person.points} pts</b></div>)}<p>Each vertical marker shows the same team average.</p></div></details>
            </> : <div className={styles.empty}><h2>No workers on this mission</h2><p>This local mission has no associated workers. No agents connect from this preview.</p><Button variant="outline" className={styles.control} onClick={() => switchMission("build")}>View sample team</Button></div>}
          </TabsContent>
          <TabsContent value="activity"><h2>Mission activity</h2><p className={styles.intro}>Fixture history and changes made in this local preview.</p>{events.length ? events.map(event => { const task = event.task_id ? tasks.find(task => task.id === event.task_id) : undefined; const agent = event.agent_id ? agents.find(agent => agent.id === event.agent_id) : undefined; return <article className={styles.event} key={event.id}><div><p>{event.message ?? event.type.replaceAll("_", " ")}</p><small>{task ? task.title : "Mission event"} · {agent ? agent.name : task ? "No worker attributed" : "No worker or task"}</small>{task && <Button variant="ghost" className={`${styles.control} mt-2`} onClick={clickEvent => { setView("tasks"); inspect(task.id, clickEvent.currentTarget); }}>Inspect task</Button>}</div><time dateTime={event.created_at} className={styles.numeric}>{age(event.created_at, board.now)}</time></article>; }) : <div className={styles.empty}><p>No history for this mission yet.</p><Button variant="outline" className={styles.control} onClick={() => setView("attention")}>View attention</Button></div>}</TabsContent>
        </Tabs>
        <Coordination />
      </>}
    </div></main>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{localAnnouncement}</div>
    <div className={styles.announcement} role="status" aria-live="polite" aria-atomic="true">{board.announcement}</div>
  </div>;
}
