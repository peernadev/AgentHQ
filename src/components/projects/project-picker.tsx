"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, FolderGit2, Plus, RotateCcw } from "lucide-react";
import { AgentHQMark } from "@/components/agenthq-mark";
import { apiRequest } from "@/lib/client/api-client";
import { useFirebaseAuth } from "@/lib/client/auth-provider";
import { lastProject, useMe } from "@/lib/client/use-me";
import type { CreateProjectResponse } from "@/types/api";
import styles from "../agent-network-dashboard.module.css";

const PROD_URL = "https://agenthq-nine.vercel.app";

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className={styles.secondary} onClick={async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the text is selectable */ }
  }}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? "Copied" : label}</button>;
}

/** The join code is shown exactly once, right after creation (only its hash is stored). */
function JoinCodeOnce({ created, onDone }: { created: CreateProjectResponse; onDone: () => void }) {
  const origin = typeof window === "undefined" ? PROD_URL : window.location.origin;
  const command = `HQ_URL=${origin} node cli/hq.mjs join --code ${created.join_code} \\\n  --participant <your name> --name <agent name> --role worker --tool claude`;
  return <section className={styles.joinOnce} aria-labelledby="join-once-heading">
    <h2 id="join-once-heading"><Check size={18} aria-hidden="true" /> {created.project.name} is ready</h2>
    <p><strong>Copy the join code now: it is shown only once.</strong> Agents use it to join this project; owners can rotate it later if it leaks.</p>
    <div className={styles.joinCodeRow}><code className={styles.joinCode}>{created.join_code}</code><CopyButton text={created.join_code} label="Copy code" /></div>
    <h3>Join command (run in a clone of {created.project.repo_url.replace("https://github.com/", "")})</h3>
    <pre className={styles.failureLog}>{command}</pre>
    <div className={styles.taskActions}><CopyButton text={command.replace(" \\\n  ", " ")} label="Copy command" /><Link className={styles.primary} href={`/p/${created.project.id}`} onClick={onDone}>Open {created.project.name} <ArrowRight size={14} aria-hidden="true" /></Link></div>
  </section>;
}

function NewProjectForm({ onCreated, onCancel }: { onCreated: (res: CreateProjectResponse) => void; onCancel: () => void }) {
  const { user } = useFirebaseAuth();
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className={styles.projectForm} aria-labelledby="new-project-heading" aria-busy={busy} onSubmit={async (event) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true); setError("");
    try {
      onCreated(await apiRequest<CreateProjectResponse>(user, "/api/projects", { method: "POST", body: { name: name.trim(), repo_url: repo.trim(), default_branch: branch.trim() || "main" } }));
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create the project."); } finally { setBusy(false); }
  }}>
    <h2 id="new-project-heading">New project</h2>
    <p>A project is one GitHub repo and its team. Missions are features inside it.</p>
    <label className={styles.formField}>Name<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} placeholder="e.g. Team app" disabled={busy} autoFocus /></label>
    <label className={styles.formField}>GitHub repo URL<input value={repo} onChange={(e) => setRepo(e.target.value)} required pattern="https://github\.com/[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+/?" placeholder="https://github.com/owner/repo" disabled={busy} /></label>
    <label className={styles.formField}>Default branch<input value={branch} onChange={(e) => setBranch(e.target.value)} maxLength={100} disabled={busy} /></label>
    {error && <p className={`${styles.inlineResult} ${styles.error}`} role="alert">{error}</p>}
    <div className={styles.taskActions}><button className={styles.primary} type="submit" disabled={busy}>{busy ? <><span className={styles.spinner} aria-hidden="true" />Creating…</> : <><Plus size={15} aria-hidden="true" />Create project</>}</button><button className={styles.secondary} type="button" onClick={onCancel} disabled={busy}>Cancel</button></div>
  </form>;
}

export function ProjectPicker() {
  const { user, signOut } = useFirebaseAuth();
  const { me, error, loading, refresh } = useMe();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreateProjectResponse | null>(null);
  const last = typeof window === "undefined" ? null : lastProject();
  const projects = [...(me?.projects ?? [])].sort((a, b) => Number(b.project.id === last) - Number(a.project.id === last));

  return <main className={`${styles.root} ${styles.live}`}>
    <header className={`${styles.topbar} bg-hex`}>
      <span className={styles.brand}><AgentHQMark /><span>AgentHQ</span></span>
      <span className={styles.previewLabel}>Projects</span>
      <div className={styles.topbarEnd}><span className={styles.userMenu}><span>{user?.email}</span><button onClick={() => signOut().catch(() => {})}>Sign out</button></span></div>
    </header>
    <div className={styles.page}>
      <header className={styles.missionHeader}>
        <div><div className={styles.titleLine}><h1>Your projects</h1></div><p>Pick a project to open its mission control. Each project has its own team, agents and join code.</p></div>
        <div className={styles.missionControls}>{me?.can_create_projects && !creating && !created && <button className={styles.primary} onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" />New project</button>}</div>
      </header>
      {created ? <JoinCodeOnce created={created} onDone={() => setCreated(null)} />
        : creating ? <NewProjectForm onCancel={() => setCreating(false)} onCreated={(res) => { setCreating(false); setCreated(res); refresh(); }} />
        : null}
      {error ? <div className={styles.banner} role="alert"><p>{error}</p><button className={styles.secondary} onClick={refresh}><RotateCcw size={14} aria-hidden="true" />Retry</button></div>
        : loading && !me ? <div className={styles.loadingState} role="status"><span className={styles.spinner} aria-hidden="true" />Loading your projects…</div>
        : !projects.length ? <div className={styles.empty}><FolderGit2 size={30} aria-hidden="true" /><h3>No projects yet</h3><p>{me?.can_create_projects ? "Create the first project for your repo." : `Ask a project owner to add ${me?.email ?? "your Google email"} on their Team page.`}</p></div>
        : <ul className={styles.projectGrid} aria-label="Projects">{projects.map(({ project, role }) => <li key={project.id}>
          <Link className={styles.projectCard} href={`/p/${project.id}`}>
            <span className={styles.projectCardHead}><FolderGit2 size={18} aria-hidden="true" /><strong>{project.name}</strong>{project.id === last && <span className={styles.badge}>Last opened</span>}</span>
            <span className={styles.mono}>{project.repo_url.replace("https://github.com/", "")} · {project.default_branch}</span>
            <span className={styles.projectCardFoot}><span>{role === "owner" ? "Owner" : "Member"}</span><span>Open <ArrowRight size={14} aria-hidden="true" /></span></span>
          </Link>
        </li>)}</ul>}
      <footer className={styles.footer}><span>Live Firestore data</span><span>Only members of a project can see it.</span></footer>
    </div>
  </main>;
}
