"use client";

// Shared pieces of the network view: used by the live dashboard at / and the mock reference at /lab/network.
import { useState, type CSSProperties } from "react";
import { ArrowRight, Check, ChevronRight, Code2, Minus, Plus, Server, X } from "lucide-react";
import type { Agent, Participant, Task } from "@/types/api";
import styles from "../agent-network-dashboard.module.css";

export type Variant = "orbit" | "relay" | "constellation" | "branches" | "focus";
type Point = readonly [number, number];
type Geometry = { hub: Point; nodes: Point[]; owners: Point[] };

export const variants: { id: Variant; name: string; description: string }[] = [
  { id: "orbit", name: "Orbit", description: "A shared center, three teams" },
  { id: "relay", name: "Relay", description: "A clear route from server to workers" },
  { id: "constellation", name: "Constellation", description: "An open field of individual workers" },
  { id: "branches", name: "Branches", description: "Three distinct participant lanes" },
  { id: "focus", name: "Focus", description: "One worker, with the rest in reach" },
];
const layouts: Record<Variant, Geometry> = {
  orbit: { hub: [500, 285], nodes: [[160, 120], [160, 325], [840, 120], [840, 325], [365, 510], [655, 510]], owners: [[250, 220], [735, 220], [505, 440]] },
  relay: { hub: [160, 290], nodes: [[520, 100], [830, 100], [520, 295], [830, 295], [520, 490], [830, 490]], owners: [[520, 40], [520, 235], [520, 430]] },
  constellation: { hub: [455, 265], nodes: [[145, 110], [225, 390], [720, 100], [860, 320], [485, 495], [805, 520]], owners: [[115, 265], [800, 210], [625, 430]] },
  branches: { hub: [160, 300], nodes: [[685, 105], [875, 105], [685, 300], [875, 300], [685, 495], [875, 495]], owners: [[500, 105], [500, 300], [500, 495]] },
  focus: { hub: [210, 270], nodes: [[680, 270], [680, 270], [680, 270], [680, 270], [680, 270], [680, 270]], owners: [] },
};

/** The variant's hand-placed positions, plus ring positions around the hub for any extra workers or owners. */
function geometryFor(variant: Variant, agents: number, owners: number): Geometry {
  const base = layouts[variant];
  const ring = (count: number, rx: number, ry: number, offset: number): Point[] => Array.from({ length: count }, (_, i) => {
    const angle = offset + (2 * Math.PI * i) / count;
    return [Math.round(Math.min(940, Math.max(60, base.hub[0] + rx * Math.cos(angle)))), Math.round(Math.min(560, Math.max(40, base.hub[1] + ry * Math.sin(angle))))] as const;
  });
  const extraNodes = Math.max(0, agents - base.nodes.length);
  const extraOwners = variant === "focus" ? 0 : Math.max(0, owners - base.owners.length);
  return {
    hub: base.hub,
    nodes: extraNodes ? [...base.nodes, ...ring(extraNodes, 420, 250, -Math.PI / 2 + 0.35)] : base.nodes,
    owners: extraOwners ? [...base.owners, ...ring(extraOwners, 250, 160, Math.PI / 2 + 0.6)] : base.owners,
  };
}

export const taskLabels: Record<Task["status"], string> = { draft: "Draft", queued: "Queued", claimed: "Claimed", in_progress: "In progress", in_review: "In review", done: "Merged / done", failed: "Failed", cancelled: "Cancelled" };
export const missionLabels = { planning: "Planning", awaiting_approval: "Awaiting approval", running: "Running", reviewing: "Reviewing", done: "Done" };
const position = ([x, y]: Point): CSSProperties => ({ left: `${x / 10}%`, top: `${y / 6}%` });

export function age(timestamp: string | null, now: number) {
  if (!timestamp || !now) return "—";
  const seconds = Math.max(0, Math.floor((now - new Date(timestamp).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
}
export function assignedTask(agent: Agent, tasks: Task[]) {
  return tasks.find(task => task.id === agent.current_task_id) ?? tasks.find(task => task.agent_id === agent.id && ["claimed", "in_progress", "in_review"].includes(task.status));
}
export function WorkerStatus({ agent }: { agent: Agent }) {
  return <span className={`${styles.status} ${styles[agent.status]}`}><i aria-hidden="true" />{agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}</span>;
}

export function TaskEvidence({ task, reviewHeading = "Gemini review" }: { task: Task; reviewHeading?: string }) {
  const reviewValid = task.review && task.review.sha === task.head_sha;
  return <>
    {task.result_summary && <div className={styles.detailSection}><h3>Reported result</h3><p>{task.result_summary}</p></div>}
    {(task.branch || task.head_sha || task.pr_url) && <div className={styles.evidence}>
      <h3>Pull request evidence</h3>
      {task.branch && <div><span>Branch</span><code>{task.branch}</code></div>}
      {task.head_sha && <div><span>HEAD</span><code>{task.head_sha}</code></div>}
      {task.pr_url && <a href={task.pr_url} target="_blank" rel="noreferrer">Open submitted PR <ArrowRight size={14} aria-hidden="true" /></a>}
    </div>}
    {task.checks && <div className={styles.checks} aria-label="Submitted check results">{(["lint", "typecheck", "build"] as const).map(key => <div key={key}><span>{key === "typecheck" ? "Types" : key.charAt(0).toUpperCase() + key.slice(1)}</span><span className={task.checks?.[key] ? styles.passed : styles.failed}>{task.checks?.[key] ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}{task.checks?.[key] ? "Passed" : "Failed"}</span></div>)}</div>}
    {task.review && <div className={styles.review}>
      <h3>{reviewHeading}</h3>
      <p className={!reviewValid ? styles.failed : undefined}>{reviewValid ? task.review.verdict.replaceAll("_", " ") : "Review void · HEAD changed"} · <code>{task.review.sha}</code></p>
      <p>{task.review.notes}</p>
      {task.review.evidence?.length ? <ul className={styles.scopeList}>{task.review.evidence.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
      <small>A review is bound to its SHA. Passing checks and a human merge are still required.</small>
    </div>}
  </>;
}

export interface NetworkProps {
  agents: Agent[]; participants: Participant[]; tasks: Task[]; workload: Participant[];
  variant: Variant; selected: string; select: (id: string) => void;
  /** Short label under a worker node, e.g. "Codex 01" (mock) or the agent's name (live). */
  nodeLabel: (agent: Agent) => string;
  serverCaption: string;
  emptyText: string;
}

export function Network({ agents, participants, tasks, workload, variant, selected, select, nodeLabel, serverCaption, emptyText }: NetworkProps) {
  const [zoom, setZoom] = useState(1);
  const owners = workload.filter(person => agents.some(agent => agent.participant_id === person.id));
  const geometry = geometryFor(variant, agents.length, owners.length);
  const focused = agents.find(agent => agent.id === selected) ?? agents[0];
  const node = (agent: Agent, index: number, strip = false) => {
    const person = participants.find(item => item.id === agent.participant_id);
    const task = assignedTask(agent, tasks);
    const inReview = agent.status === "idle" && task?.status === "in_review";
    return <button id={`network-worker-${agent.id}`} key={agent.id} type="button" className={`${styles.workerNode} ${strip ? styles.stripNode : ""} ${styles[agent.status]} ${inReview ? styles.reviewing : ""}`} style={strip ? undefined : position(geometry.nodes[index] ?? [800, 300])} onClick={() => select(agent.id)} aria-pressed={selected === agent.id} aria-label={`${person?.name ?? "Teammate"}, ${agent.name}, ${agent.status}${task ? `, ${task.title}` : ""}`}>
      <span className={styles.disc}><Code2 size={22} aria-hidden="true" /><i aria-hidden="true" /></span>
      <strong>{variant === "focus" && !strip ? person?.name : nodeLabel(agent)}</strong>
      <span className={styles.nodeState}>{agent.status === "working" ? task?.title ?? "Working" : inReview ? "Idle · PR in review" : agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}</span>
      {variant === "focus" && !strip && <small>{agent.name}</small>}
    </button>;
  };
  return <div className={styles.networkRegion}>
    <div className={styles.mapHeading}><h2>{variant === "focus" ? "One worker in focus" : "Team network"}</h2><span>{variant === "branches" ? "Workers grouped by teammate" : "Select a worker to inspect its work"}</span></div>
    {!agents.length ? <div className={styles.empty}><Server size={30} aria-hidden="true" /><h3>No workers yet</h3><p>{emptyText}</p></div> : <>
      <div className={styles.graph}>
        <div className={styles.graphSpace} style={{ transform: `scale(${zoom})` }}>
          <svg className={styles.connections} viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">
            {variant === "branches" ? owners.map((person, index) => {
              const end = geometry.owners[index];
              const active = agents.some(agent => agent.id === selected && agent.participant_id === person.id);
              return <path key={person.id} className={active ? styles.activeEdge : undefined} d={`M ${geometry.hub[0]} ${geometry.hub[1]} C 330 ${geometry.hub[1]}, 350 ${end[1]}, ${end[0]} ${end[1]}`} />;
            }) : agents.filter(agent => variant !== "focus" || agent.id === focused?.id).map(agent => {
              const index = agents.findIndex(item => item.id === agent.id);
              const end = geometry.nodes[index] ?? [800, 300];
              const live = agent.status === "working";
              return <path key={agent.id} className={`${selected === agent.id || variant === "focus" ? styles.activeEdge : ""} ${live ? styles.workingEdge : ""}`} d={`M ${geometry.hub[0]} ${geometry.hub[1]} C ${(geometry.hub[0] + end[0]) / 2} ${geometry.hub[1]}, ${(geometry.hub[0] + end[0]) / 2} ${end[1]}, ${end[0]} ${end[1]}`} />;
            })}
          </svg>
          {variant === "branches" && owners.map((person, index) => <div className={styles.branchLane} key={person.id} style={{ top: `${(geometry.owners[index][1] - 70) / 6}%` }}><span className={styles.branchPort} /><strong>{person.name}</strong><small>{person.points} workload {person.points === 1 ? "point" : "points"}</small></div>)}
          {variant !== "focus" && variant !== "branches" && owners.map((person, index) => <div key={person.id} className={styles.owner} style={position(geometry.owners[index] ?? [500, 500])}><span>{person.name.charAt(0)}</span><div><strong>{person.name}</strong><small>{person.points} workload {person.points === 1 ? "point" : "points"}</small></div></div>)}
          <button className={styles.serverNode} onClick={() => select("server")} style={position(geometry.hub)} aria-pressed={selected === "server"} aria-label="Inspect AgentHQ server and planning rules"><span className={styles.serverDisc}><Server size={28} aria-hidden="true" /></span><strong>AgentHQ</strong><span>Coordination server</span><small>Claim & report</small></button>
          {variant === "focus" ? focused && node(focused, agents.findIndex(agent => agent.id === focused.id)) : agents.map((agent, index) => node(agent, index))}
        </div>
      </div>
      {variant === "focus" && <div className={styles.workerStrip} aria-label="Other workers">{agents.filter(agent => agent.id !== focused?.id).map((agent, index) => node(agent, index, true))}</div>}
      <div className={styles.mapFooter}><span>Workers pull work + report through the server</span><div className={styles.zoom} aria-label="Graph zoom"><button aria-label="Zoom out" disabled={zoom <= 0.8} onClick={() => setZoom(current => Math.max(0.8, +(current - 0.1).toFixed(1)))}><Minus size={14} aria-hidden="true" /></button><output aria-label="Current zoom">{Math.round(zoom * 100)}%</output><button aria-label="Zoom in" disabled={zoom >= 1.2} onClick={() => setZoom(current => Math.min(1.2, +(current + 0.1).toFixed(1)))}><Plus size={14} aria-hidden="true" /></button><button onClick={() => setZoom(1)}>Fit</button></div></div>
    </>}
    <div className={styles.mobileWorkers} aria-label="Workers"><button className={styles.mobileServer} onClick={() => select("server")} aria-pressed={selected === "server"}><Server size={20} aria-hidden="true" /><span><strong>AgentHQ server</strong><small>{serverCaption}</small></span><ChevronRight size={16} aria-hidden="true" /></button>{agents.map(agent => { const owner = participants.find(person => person.id === agent.participant_id); const task = assignedTask(agent, tasks); return <button key={agent.id} onClick={() => select(agent.id)} aria-pressed={selected === agent.id}><span className={styles.mobileWorkerIcon}><Code2 size={18} aria-hidden="true" /></span><span><strong>{owner?.name ?? "Teammate"} · {nodeLabel(agent)}</strong><small>{task ? task.title : "No current task"}</small></span><WorkerStatus agent={agent} /></button>; })}</div>
  </div>;
}
