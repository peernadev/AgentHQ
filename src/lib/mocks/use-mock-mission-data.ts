"use client";

import { useEffect, useRef, useState } from "react";
import { createMissionSnapshot, MOCK_PROJECT_ID, mockMissionAgents, taskPoints } from "@/lib/mocks/mission";
import type { CreateMissionRequest, CreateMissionResponse, Task } from "@/types/api";

/** Local mock adapter: replace this boundary when the backend is ready. No network writes. */
export function useMockMissionData() {
  const [data, setData] = useState(() => createMissionSnapshot());
  const [missionId, setMissionId] = useState("build");
  const [selectedTaskId, setSelectedTaskId] = useState("t4");
  const [now, setNow] = useState(0);
  const [approving, setApproving] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [planning, setPlanning] = useState(false);
  const [planningError, setPlanningError] = useState("");
  const [queueTab, setQueueTab] = useState("up-next");
  const planningLock = useRef(false);
  const planVersion = useRef(0);
  const approvalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const lifecycleVersion = planVersion;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); lifecycleVersion.current++; if (approvalTimer.current) clearTimeout(approvalTimer.current); };
  }, []);
  const mission = data.missions.find(item => item.id === missionId)!;
  const tasks = data.tasks.filter(task => task.mission_id === mission.id);
  const agents = data.agents.filter(agent => (mockMissionAgents[mission.id] ?? []).includes(agent.id));
  const missionTaskCounts = Object.fromEntries(data.missions.map(item => [item.id, data.tasks.filter(task => task.mission_id === item.id).length]));
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
    if (approving || planningLock.current) return;
    setMissionId(id);
    setSelectedTaskId(data.tasks.find(item => item.mission_id === id)?.id ?? "");
    setAnnouncement("");
  }
  function approveAll() {
    if (!drafts.length || approving || planningLock.current) return;
    setApproving(true);
    const ids = drafts.map(task => task.id);
    approvalTimer.current = setTimeout(() => {
      setData(current => ({
        ...current,
        tasks: current.tasks.map(task => ids.includes(task.id) ? { ...task, status: "queued", updated_at: new Date().toISOString() } : task),
        events: [{ id: String(Date.now()), project_id: MOCK_PROJECT_ID, mission_id: missionId, task_id: ids[0], agent_id: null, type: "approved", message: `Approved ${ids.length} mock drafts · added to the queue`, data: null, created_at: new Date().toISOString() }, ...current.events],
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
    if (approving || planningLock.current) return;
    setData(createMissionSnapshot());
    setMissionId("build");
    setSelectedTaskId("t4");
    setNow(Date.now());
    setAnnouncement("Mock demo reset.");
    setQueueTab("up-next");
    setPlanningError("");
  }
  async function planMission(input: CreateMissionRequest): Promise<CreateMissionResponse> {
    if (planningLock.current || approving) throw new Error("A mock action is already in progress.");
    const title = input.title.trim();
    const goal = input.goal.trim();
    if (title.length < 3 || title.length > 80 || goal.length < 10 || goal.length > 1200) {
      const message = "Use a title of 3–80 characters and a goal of 10–1,200 characters.";
      setPlanningError(message);
      throw new Error(message);
    }
    planningLock.current = true;
    setPlanning(true);
    setPlanningError("");
    setAnnouncement("Creating a local fixture plan. No Gemini request is sent.");
    const version = ++planVersion.current;
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (version !== planVersion.current) throw new Error("Planning cancelled.");
      const id = `mock-${Date.now()}`;
      const timestamp = new Date().toISOString();
      const mission: CreateMissionResponse["mission"] = { id, project_id: MOCK_PROJECT_ID, title, goal, status: "awaiting_approval", source_doc_id: null, source_doc_url: null, plan_doc_url: null, handoff_doc_url: null, created_by: "mock-planner", created_at: timestamp };
      const steps = ["Define acceptance criteria", "Build the first scoped slice", "Verify and document the result"];
      const drafts: Task[] = steps.map((step, index) => ({
        id: `${id}-task-${index + 1}`, project_id: MOCK_PROJECT_ID, mission_id: id, title: `${step}: ${title}`,
        description: `Fixture step ${index + 1} for your goal: ${goal}`, acceptance: `Document evidence for: ${goal}`,
        priority: index + 1, size: index === 1 ? "M" : "S", scope: [`src/missions/${id}/${["criteria", "implementation", "verification"][index]}/`], depends_on: [],
        status: "draft", agent_id: null, attempt_id: null, lease_expires_at: null, branch: null, pr_url: null, head_sha: null, checks: null, review: null, result_summary: null,
        created_by: "mock-planner", claimed_at: null, completed_at: null, created_at: timestamp, updated_at: timestamp,
      }));
      const response: CreateMissionResponse = { mission, task_ids: drafts.map(task => task.id) };
      setData(current => ({ ...current, missions: [...current.missions, mission], tasks: [...current.tasks, ...drafts], events: [{ id: `${id}-created`, project_id: MOCK_PROJECT_ID, mission_id: id, task_id: null, agent_id: null, type: "created", message: "Mock mission planned · 3 deterministic fixture drafts created", data: null, created_at: timestamp }, ...current.events] }));
      setMissionId(id);
      setSelectedTaskId(response.task_ids[0]);
      setQueueTab("drafts");
      setAnnouncement(`Mock plan created for ${title}. Review three fixture drafts before approval.`);
      return response;
    } catch (error) {
      if (version === planVersion.current) setPlanningError(error instanceof Error ? error.message : "Mock planning failed. Try again.");
      throw error;
    } finally {
      if (version === planVersion.current) { planningLock.current = false; setPlanning(false); }
    }
  }
  return { ...data, mission, missionTaskCounts, tasks, agents, scopeLocks, selectedTask, workload, drafts, queue, now, approving, planning, planningError, queueTab, setQueueTab, planMission, announcement, selectMission, selectTask: setSelectedTaskId, approveAll, moveTask, reset };
}
