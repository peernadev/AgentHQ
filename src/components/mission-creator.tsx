"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CreateMissionRequest, CreateMissionResponse } from "@/types/api";
import styles from "@/components/mission-dashboard.module.css";

interface MissionCreatorProps {
  planning: boolean;
  disabled: boolean;
  error: string;
  mode?: "live" | "mock";
  onPlan: (input: CreateMissionRequest) => Promise<CreateMissionResponse>;
  onCancel?: () => void;
}

export function MissionCreator({ planning, disabled, error, mode = "mock", onPlan, onCancel }: MissionCreatorProps) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const live = mode === "live";
  return <section aria-labelledby="new-mission-heading" className={styles.creator}>
    <h1 id="new-mission-heading">What are we working toward?</h1>
    <p id="mission-plan-help" className={styles.goal}>Give the mission a clear goal. Create a draft plan to review before it enters the queue.</p>
    <form aria-describedby="mission-plan-help mission-planner-provenance" aria-busy={planning} onSubmit={async event => {
      event.preventDefault();
      try { await onPlan({ title: title.trim(), goal: goal.trim() }); } catch { /* The adapter exposes validation and server errors; keep the goal available for retry. */ }
    }}>
      <div className={styles.field}><label htmlFor="mission-title">Mission name</label><Input autoFocus id="mission-title" value={title} onChange={event => setTitle(event.target.value)} required minLength={3} maxLength={80} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? "mission-plan-error" : undefined} placeholder="For example, prepare the product demo" /></div>
      <div className={styles.field}><label htmlFor="mission-goal">Goal</label><textarea id="mission-goal" value={goal} onChange={event => setGoal(event.target.value)} required minLength={10} maxLength={1200} disabled={disabled} aria-invalid={Boolean(error)} aria-describedby={error ? "mission-plan-error" : undefined} rows={4} placeholder="Describe what the team should deliver and what success looks like." /></div>
      {error && <p id="mission-plan-error" role="alert" className={styles.formError}>{error}</p>}
      <div className={styles.formActions}><Button type="submit" disabled={disabled} className={styles.control}>{planning ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}{planning ? live ? "Planning with Gemini…" : "Creating mock plan…" : live ? error ? "Retry plan with Gemini" : "Plan with Gemini" : "Plan with Gemini (mock)"}</Button>{onCancel && <Button variant="ghost" type="button" className={styles.control} onClick={onCancel} disabled={disabled}>Cancel</Button>}</div>
      <p id="mission-planner-provenance" className={styles.formNote}>{live ? "Gemini proposes scoped tasks through the server. Review the saved drafts before approval; workers claim approved tasks through the hq CLI. If a cached demo plan is used, the mission will say so." : "Local mock planner. Your title and goal produce three deterministic fixture drafts with illustrative scopes. No Gemini request, Google Doc access, worker dispatch or server write occurs."}</p>
    </form>
  </section>;
}
