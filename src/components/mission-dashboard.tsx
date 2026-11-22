"use client";

import { ArrowDown, ArrowUp, ArrowUpRight, Check, ChevronRight, Circle, Clock3, GitPullRequest, Layers3, Loader2, Radio, RotateCcw, ShieldCheck, Sparkles, Terminal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMissionData } from "@/lib/client/use-mission-data";
import { taskPoints } from "@/lib/mocks/mission";
import type { AgentStatus, TaskStatus } from "@/types/api";

const statusStyles: Record<AgentStatus | TaskStatus, string> = {
  working: "bg-emerald-100 text-emerald-950", idle: "bg-blue-100 text-blue-950",
  blocked: "bg-amber-100 text-amber-950", offline: "bg-zinc-200 text-zinc-800",
  draft: "bg-muted text-foreground", queued: "bg-blue-100 text-blue-950",
  claimed: "bg-amber-100 text-amber-950", in_progress: "bg-emerald-100 text-emerald-950",
  in_review: "bg-violet-100 text-violet-950", done: "bg-emerald-100 text-emerald-950",
  failed: "bg-red-100 text-red-950", cancelled: "bg-muted text-foreground",
};
const statusLabels: Record<AgentStatus | TaskStatus, string> = {
  working: "Working", idle: "Idle", blocked: "Blocked", offline: "Offline", draft: "Draft", queued: "Queued",
  claimed: "Claimed", in_progress: "In progress", in_review: "In review", done: "Done", failed: "Failed", cancelled: "Cancelled",
};
const personStyles = [
  { avatar: "bg-indigo-100 text-indigo-950", bar: "bg-indigo-600" },
  { avatar: "bg-teal-100 text-teal-950", bar: "bg-teal-700" },
  { avatar: "bg-amber-100 text-amber-950", bar: "bg-amber-600" },
];
function Status({ status }: { status: AgentStatus | TaskStatus }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-semibold ${statusStyles[status]}`}><Circle className="size-2 fill-current" aria-hidden="true" />{statusLabels[status]}</span>;
}
function age(iso: string, now: number) {
  if (!now) return "…";
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}

export function MissionDashboard() {
  const board = useMissionData();
  const { tasks, agents, selectedTask: task } = board;
  const done = tasks.filter(item => item.status === "done").length;
  const review = task?.review;
  const checks = task?.checks ? [{ name: "TypeScript", passed: task.checks.typecheck }, { name: "Lint", passed: task.checks.lint }, { name: "Build", passed: task.checks.build }] : [];
  const average = board.workload.reduce((sum, person) => sum + person.points, 0) / board.workload.length;
  // Native meters share a scale, so both bars and the average describe the same points.
  const scale = Math.max(6, ...board.workload.map(person => person.points));
  const events = board.events.filter(event => event.task_id && board.mission.taskIds.includes(event.task_id));
  function inspect(id: string) {
    board.selectTask(id);
    if (window.matchMedia("(max-width: 1439px)").matches) {
      document.getElementById("task-inspector")?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
      document.getElementById("task-inspector")?.focus({ preventScroll: true });
    }
  }
  return (
    <main className="min-h-screen [font-family:var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif] bg-muted/35 text-foreground selection:bg-primary selection:text-primary-foreground">
      <header className="border-b bg-background px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Layers3 className="size-6" aria-hidden="true" /></div><div><p className="text-xl font-bold tracking-tight">AgentHQ</p><p className="text-sm text-foreground/70">One team. Every agent in view.</p></div></div>
          <div className="flex flex-wrap items-center gap-3"><span className="flex items-center gap-2 rounded-md bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950"><Radio className="size-4" aria-hidden="true" />Mock mode</span><Button variant="outline" className="h-10 px-3" onClick={board.reset} disabled={board.approving}><RotateCcw />Reset demo</Button></div>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1800px] gap-6 p-4 sm:p-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <aside aria-label="Missions" className="min-w-0">
          <div className="mb-4 flex items-center gap-2 text-base font-semibold"><Layers3 className="size-5" />Missions <span className="ml-auto text-sm text-foreground/65">{board.missions.length}</span></div>
          <nav className="flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {board.missions.map(mission => <button key={mission.id} onClick={() => board.selectMission(mission.id)} disabled={board.approving} aria-current={mission.id === board.mission.id ? "page" : undefined} className={`min-w-44 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${mission.id === board.mission.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}><span className="block text-base font-semibold">{mission.title}</span><span className={`mt-3 block text-sm ${mission.id === board.mission.id ? "text-primary-foreground/85" : "text-foreground/65"}`}>{mission.taskIds.length} tasks <ChevronRight className="ml-1 inline size-4" /></span></button>)}
          </nav>
          <div className="mt-6 hidden border-t pt-5 text-sm leading-relaxed text-foreground/70 lg:block"><ShieldCheck className="mb-2 size-5" /><p>Scoped work.<br />Shared visibility.</p><p className="mt-3">Sample data only. Changes stay in this browser session.</p></div>
        </aside>

        <div className="min-w-0">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{board.mission.title}</h1><p className="mt-2 max-w-prose text-base text-foreground/70">{board.mission.goal}</p></div>
            <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm"><Check className="size-4 text-emerald-700" /><span><strong>{done} / {tasks.length}</strong> tasks done</span></div>
          </div>

          <div className="grid items-start gap-6 min-[1440px]:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-6">
              <section aria-labelledby="workers-heading">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 id="workers-heading" className="flex items-center gap-2 text-xl font-semibold"><Users className="size-5" />Worker board</h2><p className="text-sm text-foreground/70">{agents.filter(agent => agent.status !== "offline").length} online · {agents.filter(agent => agent.status === "working").length} working</p></div>
                {agents.length ? <div className="grid gap-4 lg:grid-cols-3">
                  {board.participants.map((person, index) => <section key={person.id} aria-label={`${person.name}’s agents`} className="min-w-0">
                    <h3 className="mb-3 flex items-center gap-2 font-semibold"><span className={`flex size-8 items-center justify-center rounded-full text-sm ${personStyles[index].avatar}`}>{person.name[0]}</span>{person.name}<span className="ml-auto text-sm font-normal text-foreground/65">{agents.filter(agent => agent.participant_id === person.id).length} agents</span></h3>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">{agents.filter(agent => agent.participant_id === person.id).map(agent => {
                      const currentTask = tasks.find(item => item.id === agent.current_task_id);
                      return <Card key={agent.id} className={`gap-3 ${agent.status === "offline" ? "bg-muted/70" : ""}`}>
                        <CardContent className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2"><span className="break-all text-base font-semibold">{agent.name}</span><Status status={agent.status} /></div>
                          <p className="flex items-center gap-1.5 text-sm text-foreground/70"><Terminal className="size-4 shrink-0" />{agent.tool} · {agent.machine}</p>
                          {currentTask ? <button onClick={() => inspect(currentTask.id)} className="block text-left text-base font-medium underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">{currentTask.title}<ArrowUpRight className="ml-1 inline size-4" /></button> : <p className="text-base font-medium">{agent.status === "offline" ? "Disconnected" : "Ready for a task"}</p>}
                          <p className="min-h-10 text-sm leading-5 text-foreground/75">{agent.note}</p>
                          <div className="border-t pt-3"><p className="mb-1 text-sm font-medium">Scope {currentTask ? "reserved" : "available"}</p>{currentTask ? currentTask.scope.map(path => <code key={path} className="block break-all text-sm text-foreground/75">{path}</code>) : <p className="text-sm text-foreground/65">No active file lock</p>}</div>
                          <p className="flex items-center gap-1.5 text-sm tabular-nums text-foreground/70"><Clock3 className="size-4" />Heartbeat {age(agent.last_heartbeat, board.now)}</p>
                        </CardContent>
                      </Card>;
                    })}</div>
                  </section>)}
                </div> : <div className="rounded-xl border border-dashed bg-background p-6"><p className="mb-3 text-base">No workers assigned to this mission yet.</p><Button variant="outline" onClick={() => board.selectMission("build")}>View active demo mission</Button></div>}
              </section>

              <section aria-labelledby="fairness-heading" className="rounded-xl border bg-background p-5">
                <div className="flex flex-wrap justify-between gap-2"><h2 id="fairness-heading" className="text-xl font-semibold">Workload fairness</h2><span className="text-sm tabular-nums text-foreground/75">Team average <strong>{average.toFixed(1)} pts</strong></span></div>
                <p className="mt-1 text-sm text-foreground/70">Active + completed work · S = 1, M = 2, L = 4 points</p>
                <div className="mt-5 space-y-4">{board.workload.map((person, index) => <div key={person.id} className="grid grid-cols-[55px_minmax(0,1fr)_46px] items-center gap-3 text-sm"><span className="font-medium">{person.name}</span><div className="relative flex h-4 overflow-hidden rounded bg-muted" role="meter" aria-label={`${person.name} workload`} aria-valuenow={person.points} aria-valuemin={0} aria-valuemax={scale} aria-valuetext={`${person.points} points; team average ${average.toFixed(1)}`}>
                  {Array.from({ length: scale }, (_, point) => <span key={point} className={`flex-1 ${point < person.points ? personStyles[index].bar : ""}`} />)}
                  <svg className="pointer-events-none absolute inset-0 h-full w-full text-foreground" aria-hidden="true"><line x1={`${average / scale * 100}%`} x2={`${average / scale * 100}%`} y1="0" y2="100%" stroke="currentColor" strokeWidth="3" /></svg>
                </div><span className="text-right font-semibold tabular-nums">{person.points} pts</span></div>)}</div>
                <p className="mt-4 text-sm text-foreground/70">Vertical markers show the team average. Points stand in for effort; token usage is not tracked.</p>
              </section>

              <section aria-labelledby="queue-heading" className="rounded-xl border bg-background p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 id="queue-heading" className="text-xl font-semibold">Task queue</h2><Button className="h-10 px-3" disabled={!board.drafts.length || board.approving} onClick={board.approveAll}>{board.approving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Check />}{board.approving ? "Approving…" : `Approve all (${board.drafts.length})`}</Button></div>
                <Tabs defaultValue="up-next">
                  <TabsList className="mb-3 h-auto! min-h-10 w-full flex-wrap gap-1" aria-label="Task views"><TabsTrigger value="up-next" className="px-3">Up next ({board.queue.length})</TabsTrigger><TabsTrigger value="drafts" className="px-3">Drafts ({board.drafts.length})</TabsTrigger><TabsTrigger value="finished" className="px-3">Review & done</TabsTrigger></TabsList>
                  <TabsContent value="up-next"><ol className="divide-y">{board.queue.map((item, index) => <li key={item.id} className="flex items-start gap-3 py-4"><span className="pt-2 text-sm font-semibold tabular-nums text-foreground/60">{index + 1}</span><button onClick={() => inspect(item.id)} className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><span className="text-base font-medium hover:underline">{item.title}</span><span className="mt-1 block break-all text-sm text-foreground/70">{item.scope.join(", ")} · {taskPoints[item.size]} pts</span>{item.depends_on.length > 0 && <span className="mt-1 block text-sm text-amber-900">Waiting for {tasks.find(t => t.id === item.depends_on[0])?.title ?? "dependency"}</span>}</button><div className="flex shrink-0 gap-1"><Button variant="outline" className="size-9" aria-label={`Move ${item.title} up`} disabled={index === 0} onClick={() => board.moveTask(item.id, -1)}><ArrowUp /></Button><Button variant="outline" className="size-9" aria-label={`Move ${item.title} down`} disabled={index === board.queue.length - 1} onClick={() => board.moveTask(item.id, 1)}><ArrowDown /></Button></div></li>)}</ol>{!board.queue.length && <p className="py-5 text-base text-foreground/70">Queue is empty. Approve drafts to add work.</p>}</TabsContent>
                  <TabsContent value="drafts"><div className="divide-y">{board.drafts.map(item => <button key={item.id} onClick={() => inspect(item.id)} className="flex w-full items-center justify-between gap-3 py-4 text-left focus-visible:outline-2 focus-visible:outline-primary"><span><span className="block text-base font-medium">{item.title}</span><code className="mt-1 block break-all text-sm text-foreground/70">{item.scope[0]}</code></span><span className="shrink-0 text-sm">{taskPoints[item.size]} pts</span></button>)}</div>{!board.drafts.length && <div className="py-5"><p className="mb-3 text-base text-foreground/70">All drafts approved. The queue is ready.</p><Button variant="outline" onClick={board.reset}>Reset demo drafts</Button></div>}</TabsContent>
                  <TabsContent value="finished"><div className="divide-y">{tasks.filter(item => ["in_review", "done"].includes(item.status)).map(item => <button key={item.id} onClick={() => inspect(item.id)} className="flex w-full flex-wrap items-center justify-between gap-3 py-4 text-left focus-visible:outline-2 focus-visible:outline-primary"><span className="text-base font-medium">{item.title}</span><Status status={item.status} /></button>)}</div>{!tasks.some(item => ["in_review", "done"].includes(item.status)) && <div className="py-5"><p className="mb-3 text-base text-foreground/70">No completed work here yet.</p><Button variant="outline" onClick={() => board.selectMission("build")}>View sample review</Button></div>}</TabsContent>
                </Tabs>
                <p className="mt-3 border-t pt-3 text-sm text-foreground/65">Priority runs top to bottom. Approval and ordering are local mock actions.</p>
              </section>
            </div>

            <aside id="task-inspector" tabIndex={-1} aria-labelledby="inspector-heading" className="min-w-0 scroll-mt-5 rounded-xl border bg-background p-5 focus-visible:outline-2 focus-visible:outline-primary min-[1440px]:sticky min-[1440px]:top-6">
              <div className="mb-5 flex items-center justify-between gap-3"><h2 id="inspector-heading" className="text-xl font-semibold">Task inspector</h2>{task && <Status status={task.status} />}</div>
              {task ? <div className="space-y-6">
                <div><p className="mb-2 text-sm tabular-nums text-foreground/65">{task.id.toUpperCase()} · {task.size} / {taskPoints[task.size]} points</p><h3 className="text-2xl font-semibold leading-tight tracking-tight">{task.title}</h3><p className="mt-3 text-base leading-relaxed text-foreground/75">{task.description}</p></div>
                <div><h4 className="mb-2 font-semibold">Acceptance criteria</h4><p className="text-base leading-relaxed text-foreground/75">{task.acceptance || "No acceptance criteria supplied."}</p></div>
                <div><h4 className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="size-4" />File scope</h4>{task.scope.map(path => <code key={path} className="block break-all rounded-md bg-muted px-3 py-2 text-sm">{path}</code>)}<p className="mt-2 text-sm text-foreground/70">{["claimed", "in_progress", "in_review"].includes(task.status) ? "Reserved until this task is complete." : "No active scope reservation."}</p></div>
                {task.depends_on.length > 0 && <div><h4 className="mb-2 font-semibold">Dependencies</h4>{task.depends_on.map(id => <button key={id} className="block text-left text-sm underline underline-offset-4" onClick={() => board.selectTask(id)}>{tasks.find(item => item.id === id)?.title ?? id}</button>)}</div>}
                <div className="border-t pt-5"><h4 className="mb-3 flex items-center gap-2 font-semibold"><GitPullRequest className="size-4" />Pull request</h4>{task.pr_url ? <><p className="mb-2 text-sm text-foreground/70">Mock PR · opens the repository PR list</p><a href={task.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium underline underline-offset-4">Open repository pull requests<ArrowUpRight className="size-4" /></a><p className="mt-2 break-all font-mono text-sm text-foreground/70">{task.branch}</p><p className="mt-3 text-sm leading-relaxed text-foreground/75">{task.result_summary}</p></> : <p className="text-sm text-foreground/70">No pull request opened yet.</p>}</div>
                <div><h4 className="mb-3 font-semibold">PR checks <span className="font-normal text-foreground/65">· mock</span></h4>{checks.length ? <ul className="space-y-2">{checks.map(check => <li key={check.name} className="flex items-center justify-between gap-2 text-sm"><span>{check.name}</span><span className={`flex items-center gap-1.5 font-medium ${check.passed ? "text-emerald-800" : "text-amber-900"}`}>{check.passed ? <Check className="size-4" /> : <Clock3 className="size-4" />}{check.passed ? "Passed" : "Failed"}</span></li>)}</ul> : <p className="text-sm text-foreground/70">Not reported. Checks appear when a sample PR is available.</p>}</div>
                <div className="rounded-lg bg-violet-50 p-4 text-violet-950"><h4 className="mb-2 flex items-center gap-2 font-semibold"><Sparkles className="size-4" />Gemini review · mock</h4>{review && <p className="mb-2 text-sm font-semibold">{review.sha === task.head_sha ? review.verdict.replaceAll("_", " ") : "Stale review · SHA changed"} · <code>{review.sha}</code></p>}<p className="text-sm leading-relaxed">{review?.notes ?? "No sample review for this task yet."}</p><p className="mt-3 text-sm font-medium">Illustrative review. No AI service is connected. Passing checks and a human merge are still required.</p></div>
              </div> : <p>Select a task to inspect its scope and review.</p>}
            </aside>
          </div>

          <section aria-labelledby="timeline-heading" className="mt-6 rounded-xl border bg-background p-5">
            <div className="mb-4 flex items-center justify-between gap-3"><h2 id="timeline-heading" className="text-xl font-semibold">Activity timeline</h2><span className="text-sm text-foreground/65">Mock events</span></div>
            {events.length ? <ol className="divide-y">{events.map(event => <li key={event.id} className="flex items-start gap-3 py-3"><span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted"><Circle className="size-2 fill-current" /></span><div className="min-w-0 flex-1"><p className="text-base">{event.message}</p>{event.task_id && <button className="mt-1 text-sm font-medium underline underline-offset-4" onClick={() => inspect(event.task_id!)}>Inspect task</button>}</div><time dateTime={board.now ? event.created_at : undefined} className="shrink-0 pt-1 text-sm tabular-nums text-foreground/65">{age(event.created_at, board.now)}</time></li>)}</ol> : <div><p className="mb-3 text-base text-foreground/70">No activity yet. Approve the draft to start this mock mission.</p><Button variant="outline" disabled={board.approving || !board.drafts.length} onClick={board.approveAll}>Approve mission draft</Button></div>}
          </section>
          <p role="status" aria-live="polite" className="mt-4 min-h-6 text-sm font-medium">{board.announcement}</p>
        </div>
      </div>
    </main>
  );
}
