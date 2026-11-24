"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { collection, onSnapshot, Timestamp, type DocumentData, type QuerySnapshot } from "firebase/firestore";
import { apiRequest } from "@/lib/client/api-client";
import { useFirebaseAuth } from "@/lib/client/auth-provider";
import { getFirebaseClient } from "@/lib/client/firebase";
import type { Agent, CreateMissionRequest, CreateMissionResponse, HqEvent, Message, Mission, Participant, RecoverResponse, ReviewTaskResponse, Task } from "@/types/api";

interface Collections {
  participants: Participant[];
  agents: Agent[];
  missions: Mission[];
  tasks: Task[];
  events: HqEvent[];
  messages: Message[];
}
type CollectionName = keyof Collections;
const collectionNames: CollectionName[] = ["participants", "agents", "missions", "tasks", "events", "messages"];
interface Session {
  user: User;
  run: number;
  active: boolean;
  version: number;
  operation: Operation | null;
  unsubscribe: (() => void)[];
}
interface Operation {
  session: Session;
  version: number;
  controller: AbortController;
}
interface State {
  session: Session | null;
  data: Collections;
  ready: Partial<Record<CollectionName, boolean>>;
  listenerErrors: Partial<Record<CollectionName, string>>;
  missionId: string | null;
  pendingMissionId: string | null;
  selectedTaskId: string | null;
  cachedMissionIds: string[];
  queueTab: string;
  now: number;
  planning: boolean;
  planningError: string;
  approving: boolean;
  actionTaskId: string | null;
  actionError: string;
  announcement: string;
}
function emptyState(session: Session | null = null): State {
  return {
    session, data: { participants: [], agents: [], missions: [], tasks: [], events: [], messages: [] },
    ready: {}, listenerErrors: {}, missionId: null, pendingMissionId: null, selectedTaskId: null,
    cachedMissionIds: [], queueTab: "up-next", now: 0, planning: false, planningError: "",
    approving: false, actionTaskId: null, actionError: "", announcement: "",
  };
}
type StateUpdate = (current: State) => State;
function reducer(current: State, update: StateUpdate): State { return update(current); }

/** Reviews and event data can contain nested Firestore timestamps. */
function timestampsToIso(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(timestampsToIso);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, timestampsToIso(item)]));
  }
  return value;
}
function documents<T>(snapshot: QuerySnapshot<DocumentData>): T[] {
  return snapshot.docs.map(doc => ({ ...(timestampsToIso(doc.data()) as Record<string, unknown>), id: doc.id }) as T);
}
function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed. Please try again.";
}
const byPriority = (a: Task, b: Task) => a.priority - b.priority || a.id.localeCompare(b.id);
const cancelled = () => new Error("Your sign-in session changed. Please try again after signing in.");

/** Live reads only. Authenticated server routes own every operational mutation. */
export function useMissionData() {
  const { user, loading: authLoading, error: authError } = useFirebaseAuth();
  const [state, update] = useReducer(reducer, null, () => emptyState());
  const [run, setRun] = useState(0);
  const sessionRef = useRef<Session | null>(null);

  function currentSession(session: Session): boolean {
    return session.active && sessionRef.current === session && getFirebaseClient().auth.currentUser === session.user;
  }
  function patch(session: Session, change: Partial<State> | ((current: State) => Partial<State>)) {
    if (!currentSession(session)) return;
    update(current => current.session === session
      ? { ...current, ...(typeof change === "function" ? change(current) : change) } : current);
  }
  function stop(session: Session) {
    session.active = false;
    session.operation?.controller.abort();
    session.operation = null;
    session.unsubscribe.splice(0).forEach(unsubscribe => unsubscribe());
    if (sessionRef.current === session) sessionRef.current = null;
    update(current => current.session === session ? emptyState() : current);
  }

  useEffect(() => {
    if (!user || authLoading) return;
    const session: Session = { user, run, active: true, version: 0, operation: null, unsubscribe: [] };
    sessionRef.current = session;
    update(() => emptyState(session));
    try {
      const { auth, db } = getFirebaseClient();
      function alive() { return session.active && sessionRef.current === session && auth.currentUser === user; }
      function subscribe<K extends CollectionName>(name: K) {
        const onError = (error: unknown) => {
          if (!alive()) return;
          update(current => current.session !== session ? current : {
            ...current, data: { ...current.data, [name]: [] }, ready: { ...current.ready, [name]: true },
            listenerErrors: { ...current.listenerErrors, [name]: `Could not load ${name}: ${failureMessage(error)}` },
          });
        };
        try {
          session.unsubscribe.push(onSnapshot(collection(db, name), snapshot => {
            if (!alive()) return;
            const rows = documents<Collections[K][number]>(snapshot);
            update(current => {
              if (current.session !== session) return current;
              const listenerErrors = { ...current.listenerErrors };
              delete listenerErrors[name];
              const pendingArrived = name === "missions" && rows.some(row => row.id === current.pendingMissionId);
              const initialMission = name === "missions" && !current.missionId && !current.pendingMissionId
                ? [...rows as Mission[]].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))[0]
                : undefined;
              return {
                ...current, data: { ...current.data, [name]: rows }, ready: { ...current.ready, [name]: true }, listenerErrors,
                missionId: initialMission?.id ?? current.missionId,
                pendingMissionId: pendingArrived ? null : current.pendingMissionId,
              };
            });
          }, onError));
        } catch (error) { onError(error); }
      }
      collectionNames.forEach(subscribe);
    } catch (error) {
      update(current => current.session !== session ? current : {
        ...current, ready: Object.fromEntries(collectionNames.map(name => [name, true])),
        listenerErrors: { participants: failureMessage(error) },
      });
    }
    const timer = setInterval(() => {
      if (session.active && sessionRef.current === session && getFirebaseClient().auth.currentUser === user) {
        const now = Date.now();
        update(current => current.session === session ? { ...current, now } : current);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      session.active = false;
      session.operation?.controller.abort();
      session.operation = null;
      session.unsubscribe.splice(0).forEach(unsubscribe => unsubscribe());
      if (sessionRef.current === session) sessionRef.current = null;
      update(current => current.session === session ? emptyState() : current);
    };
  }, [user, authLoading, run]);

  // Hide the previous session during the render before its effect cleanup runs.
  const view = user && !authLoading && state.session?.user === user && state.session.run === run ? state : emptyState();
  const { participants, agents, events, messages } = view.data;
  const missions = [...view.data.missions].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));
  const allTasks = view.data.tasks;
  const mission = view.pendingMissionId
    ? missions.find(item => item.id === view.pendingMissionId) ?? null
    : missions.find(item => item.id === view.missionId) ?? missions[0] ?? null;
  const missionId = view.pendingMissionId ?? mission?.id ?? null;
  const tasks = allTasks.filter(task => missionId !== null && task.mission_id === missionId).sort(byPriority);
  const selectedTask = view.selectedTaskId ? tasks.find(task => task.id === view.selectedTaskId) : tasks[0];
  const drafts = tasks.filter(task => task.status === "draft");
  const queue = tasks.filter(task => task.status === "queued");
  const missionTaskCounts = Object.fromEntries(missions.map(item => [item.id, allTasks.filter(task => task.mission_id === item.id).length]));
  const scopeLocks = Object.fromEntries(agents.map(agent => [agent.id, [...new Set(allTasks
    .filter(task => task.agent_id === agent.id && ["claimed", "in_progress", "in_review"].includes(task.status))
    .flatMap(task => task.scope))]]));
  const currentMissionAgents = agents.filter(agent => tasks.some(task => task.agent_id === agent.id));
  const workload = participants;
  const loading = authLoading || Boolean(user && collectionNames.some(name => !view.ready[name]));
  const error = authError || Object.values(view.listenerErrors).join(" ") || null;
  const cachedPlan = Boolean(missionId && (view.cachedMissionIds.includes(missionId) || mission?.plan_source === "cached_demo"));

  function requireSession(): Session {
    const session = sessionRef.current;
    if (!session || !currentSession(session) || session.user !== user || session.run !== run || state.session !== session) throw cancelled();
    return session;
  }
  function begin(kind: "planning" | "approving" | "task", taskId: string | null = null): Operation {
    const session = requireSession();
    if (session.operation) throw new Error("Another action is already in progress. Please wait.");
    const operation = { session, version: ++session.version, controller: new AbortController() };
    session.operation = operation;
    patch(session, { planning: kind === "planning", approving: kind === "approving", actionTaskId: taskId,
      planningError: "", actionError: "", announcement: "" });
    return operation;
  }
  function operationCurrent(operation: Operation): boolean {
    return currentSession(operation.session) && operation.session.operation === operation && operation.session.version === operation.version;
  }
  function finish(operation: Operation) {
    if (!operationCurrent(operation)) return;
    operation.session.operation = null;
    patch(operation.session, { planning: false, approving: false, actionTaskId: null });
  }
  function retry() {
    if (sessionRef.current) stop(sessionRef.current);
    setRun(value => value + 1);
  }
  function selectMission(id: string) {
    const session = requireSession();
    if (session.operation || !missions.some(item => item.id === id)) return;
    patch(session, { missionId: id, pendingMissionId: null,
      selectedTaskId: allTasks.filter(task => task.mission_id === id).sort(byPriority)[0]?.id ?? null,
      announcement: "", actionError: "" });
  }
  function selectTask(id: string) { patch(requireSession(), { selectedTaskId: id }); }
  function setQueueTab(value: string) { patch(requireSession(), { queueTab: value }); }

  async function planMission(input: CreateMissionRequest): Promise<CreateMissionResponse> {
    const session = requireSession();
    const title = input.title.trim();
    const goal = input.goal.trim();
    if (title.length < 3 || title.length > 80 || goal.length < 10 || goal.length > 1200) {
      const message = "Use a title of 3–80 characters and a goal of 10–1,200 characters.";
      patch(session, { planningError: message });
      throw new Error(message);
    }
    const operation = begin("planning");
    try {
      const response = await apiRequest<CreateMissionResponse>(session.user, "/api/missions", {
        method: "POST", body: { title, goal }, signal: operation.controller.signal,
      });
      if (!operationCurrent(operation)) throw cancelled();
      const cached = response.cached_plan === true || response.mission.plan_source === "cached_demo";
      patch(session, current => ({
        missionId: response.mission.id,
        pendingMissionId: current.data.missions.some(item => item.id === response.mission.id) ? null : response.mission.id,
        selectedTaskId: response.task_ids[0] ?? null, queueTab: "drafts",
        cachedMissionIds: cached ? [...new Set([...current.cachedMissionIds, response.mission.id])] : current.cachedMissionIds,
        announcement: response.mission.status === "planning" ? `Plan requested for ${response.mission.title}. Waiting for an orchestrator to draft it.`
          : cached ? "The AI was busy. A cached demo plan was saved; review its drafts before approval."
          : `Plan created for ${response.mission.title}. Review the drafts before approval.`,
      }));
      return response;
    } catch (error) {
      if (operationCurrent(operation)) patch(session, { planningError: failureMessage(error) });
      throw error;
    } finally { finish(operation); }
  }

  /** Called only from an explicit user click; planning never approves drafts. */
  async function approveTasks(requested: string[]): Promise<void> {
    const ids = requested.filter(id => drafts.some(task => task.id === id));
    if (!ids.length) return;
    const operation = begin("approving", ids.length === 1 ? ids[0] : null);
    try {
      await apiRequest<{ ok: boolean }>(operation.session.user, "/api/tasks/approve", {
        method: "POST", body: { ids }, signal: operation.controller.signal,
      });
      if (!operationCurrent(operation)) throw cancelled();
      patch(operation.session, { announcement: `${ids.length} ${ids.length === 1 ? "draft approved" : "drafts approved"} and added to the queue.` });
    } catch (error) {
      if (operationCurrent(operation)) patch(operation.session, { actionError: failureMessage(error) });
      throw error;
    } finally { finish(operation); }
  }
  function approveAll(): Promise<void> { return approveTasks(drafts.map(task => task.id)); }

  function taskForAction(taskId: string, requiresMission: boolean): Task {
    const session = requireSession();
    const task = allTasks.find(item => item.id === taskId);
    if (!task || (requiresMission && !task.mission_id)) {
      const message = "This task is no longer available in a mission. Refresh the live data and try again.";
      patch(session, { actionError: message });
      throw new Error(message);
    }
    return task;
  }
  async function markDone(taskId: string): Promise<void> {
    taskForAction(taskId, false);
    const operation = begin("task", taskId);
    try {
      await apiRequest<{ ok: boolean }>(operation.session.user, `/api/tasks/${encodeURIComponent(taskId)}/done`, {
        method: "POST", body: {}, signal: operation.controller.signal,
      });
      if (!operationCurrent(operation)) throw cancelled();
      patch(operation.session, { announcement: "Task marked done. Its scope lock has been released by the server." });
    } catch (error) {
      if (operationCurrent(operation)) patch(operation.session, { actionError: failureMessage(error) });
      throw error;
    } finally { finish(operation); }
  }
  async function reviewTask(taskId: string): Promise<ReviewTaskResponse> {
    const task = taskForAction(taskId, true);
    const operation = begin("task", taskId);
    try {
      const response = await apiRequest<ReviewTaskResponse>(operation.session.user, `/api/missions/${encodeURIComponent(task.mission_id!)}/review-task`, {
        method: "POST", body: { task_id: taskId }, signal: operation.controller.signal,
      });
      if (!operationCurrent(operation)) throw cancelled();
      patch(operation.session, { announcement: "Review saved with evidence for the submitted head SHA." });
      return response;
    } catch (error) {
      if (operationCurrent(operation)) patch(operation.session, { actionError: failureMessage(error) });
      throw error;
    } finally { finish(operation); }
  }
  async function recoverTask(taskId: string): Promise<RecoverResponse> {
    const task = taskForAction(taskId, true);
    const operation = begin("task", taskId);
    try {
      const response = await apiRequest<RecoverResponse>(operation.session.user, `/api/missions/${encodeURIComponent(task.mission_id!)}/recover`, {
        method: "POST", body: { task_id: taskId }, signal: operation.controller.signal,
      });
      if (!operationCurrent(operation)) throw cancelled();
      // claude-code: the orchestrator drafts it later; stay on the failed task.
      if (response.requested) patch(operation.session, { announcement: "Recovery requested from the orchestrator." });
      else patch(operation.session, current => ({
        missionId: task.mission_id,
        pendingMissionId: current.data.missions.some(item => item.id === task.mission_id) ? null : task.mission_id,
        selectedTaskId: response.task_id ?? null, queueTab: "drafts",
        announcement: "A recovery draft was saved. Review it before approving.",
      }));
      return response;
    } catch (error) {
      if (operationCurrent(operation)) patch(operation.session, { actionError: failureMessage(error) });
      throw error;
    } finally { finish(operation); }
  }

  return {
    participants, agents, missions, allTasks, tasks, events, messages, mission, missionId, missionTaskCounts,
    scopeLocks, currentMissionAgents, selectedTask, workload, drafts, queue, now: view.now,
    loading, error, retry, listenerErrors: view.listenerErrors,
    planning: view.planning, planningError: view.planningError, approving: view.approving,
    actionTaskId: view.actionTaskId, actionError: view.actionError, announcement: view.announcement,
    cachedPlan, queueTab: view.queueTab, setQueueTab, canReorder: false as const,
    planMission, approveAll, approveTasks, markDone, reviewTask, recoverTask, selectMission, selectTask,
  };
}
