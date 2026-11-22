"use client";

import { useEffect, useRef, useState } from "react";
import { createMissionSnapshot, taskPoints } from "@/lib/mocks/mission";

/** Local mock adapter: replace this boundary when the backend is ready. No network writes. */
export function useMissionData() {
  const [data, setData] = useState(() => createMissionSnapshot());
  const [missionId, setMissionId] = useState("build");
  const [selectedTaskId, setSelectedTaskId] = useState("t4");
  const [now, setNow] = useState(0);
  const [approving, setApproving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const approvalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); if (approvalTimer.current) clearTimeout(approvalTimer.current); };
  }, []);
  const mission = data.missions.find(item => item.id === missionId)!;
  const tasks = data.tasks.filter(task => mission.taskIds.includes(task.id));
  const agents = data.agents.filter(agent => mission.agentIds.includes(agent.id));
  const scopeLocks = Object.fromEntries(data.agents.map(agent => [agent.id, [...new Set(data.tasks
    .filter(task => task.agent_id === agent.id && ["claimed", "in_progress", "in_review"].includes(task.status))
    .flatMap(task => task.scope))]]));
  const selectedTask = tasks.find(task => task.id === selectedTaskId) ?? tasks[0];
  const workload = data.participants.map(person => ({
    ...person,
    points: tasks.filter(task => task.agent_id && data.agents.some(agent => agent.id === task.agent_id && agent.participant_id === person.id) && ["claimed", "in_progress", "in_review", "done"].includes(task.status)).reduce((total, task) => total + taskPoints[task.size], 0),
  }));
  const drafts = tasks.filter(task => task.status === "draft");
  const queue = tasks.filter(task => task.status === "queued").sort((a, b) => a.priority - b.priority);
  function selectMission(id: string) {
    if (approving) return;
    setMissionId(id);
    setSelectedTaskId(data.missions.find(item => item.id === id)!.taskIds[0]);
    setAnnouncement("");
  }
  function approveAll() {
    if (!drafts.length || approving) return;
    setApproving(true);
    const ids = drafts.map(task => task.id);
    approvalTimer.current = setTimeout(() => {
      setData(current => ({
        ...current,
        tasks: current.tasks.map(task => ids.includes(task.id) ? { ...task, status: "queued", updated_at: new Date().toISOString() } : task),
        events: [{ id: String(Date.now()), mission_id: missionId, task_id: ids[0], agent_id: null, type: "approved", message: `Approved ${ids.length} mock drafts · added to the queue`, data: null, created_at: new Date().toISOString() }, ...current.events],
      }));
      setApproving(false);
      setAnnouncement(`${ids.length} drafts approved locally and added to the queue.`);
    }, 500);
  }
  function moveTask(id: string, direction: -1 | 1) {
    const index = queue.findIndex(task => task.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= queue.length) return;
    const reordered = [...queue];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setData(current => ({ ...current, tasks: current.tasks.map(task => {
      const position = reordered.findIndex(item => item.id === task.id);
      return position < 0 ? task : { ...task, priority: position + 1 };
    }) }));
    setAnnouncement(`${queue[index].title} moved to queue position ${target + 1}.`);
  }
  function reset() {
    if (approving) return;
    setData(createMissionSnapshot());
    setMissionId("build");
    setSelectedTaskId("t4");
    setNow(Date.now());
    setAnnouncement("Mock demo reset.");
  }
  return { ...data, mission, tasks, agents, scopeLocks, selectedTask, workload, drafts, queue, now, approving, announcement, selectMission, selectTask: setSelectedTaskId, approveAll, moveTask, reset };
}
