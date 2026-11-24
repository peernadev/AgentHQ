#!/usr/bin/env node
// hq: AgentHQ worker CLI (SPEC §9). Plain Node 22+, no dependencies.
// Config lives in ./.hq.json (token + current attempt_id; gitignored). Server: $HQ_URL.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { parseArgs } from "node:util";

const CONFIG = ".hq.json";
const DEFAULT_URL = "http://localhost:3000";
const LOG_LINES = 40;
const CHECKS = [
  ["lint", "npm run lint"],
  ["typecheck", "npx tsc --noEmit"],
  ["build", "npm run build"],
];

const USAGE = `Usage: hq <command>
  join --code <TEAM_JOIN_CODE> --participant <name> --name <agent>
       [--role worker|orchestrator] [--tool claude|codex|antigravity|other] [--model <m>] [--machine <m>]
  claim [--json]               prints task JSON (attempt_id saved) or NO_TASK
  progress <id> "msg"
  review <id> --pr <url> --branch <b> [--summary "..."] [--allow-failing]
                               runs lint/typecheck/build, fills head_sha from git
  fail <id> "reason" [--no-checks]
                               attaches the last ${LOG_LINES} lines of the failing check
  status [--json]
  plan-requests [--json] [--wait <seconds>]
                               orchestrator: take the next open plan request (claims it), or NO_REQUEST;
                               --wait polls every 30 s (each poll is a heartbeat) until one arrives
  tasks add [--mission <id>] plan.json
                               orchestrator: submit drafts ({ tasks: [...] } or [...]); with --mission
                               for a planning mission, the plan is validated and the request closed
  msg <agent|task> "text"      message an agent (id or name) or a task's current agent
  inbox                        show unread messages (also a heartbeat)
Every call prints new messages to stderr, starting with "MESSAGE from <agent>".
Server: $HQ_URL (default ${DEFAULT_URL}). Config: ./${CONFIG}`;

class CliError extends Error {}
const die = (msg) => { throw new CliError(msg); };

// ---------- config ----------

function loadConfig({ required = true } = {}) {
  if (!existsSync(CONFIG)) {
    if (required) die(`No ${CONFIG} here. Run: hq join --code <code> --participant <you> --name <agent>`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    return die(`${CONFIG} is not valid JSON`);
  }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n", { mode: 0o600 });
}

const baseUrl = (cfg = {}) => (process.env.HQ_URL || cfg.url || DEFAULT_URL).replace(/\/+$/, "");

// ---------- http ----------

async function api(cfg, method, path, body, { auth = true } = {}) {
  const headers = { "content-type": "application/json" };
  if (auth) headers.authorization = `Bearer ${cfg.token}`;
  const url = baseUrl(cfg) + path;
  let res;
  try {
    res = await fetch(url, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    die(`Cannot reach ${url}: ${err.cause?.code ?? err.message}`);
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new CliError(`${res.status} ${data?.error ?? (text.slice(0, 200) || res.statusText)}`);
    err.status = res.status;
    throw err;
  }
  printInbox(data?.inbox);
  return data;
}

/** Messages are marked read once delivered, so always show them (stderr keeps stdout parseable). */
function printInbox(inbox) {
  for (const m of inbox ?? []) {
    const task = m.to_task ? ` (about task ${m.to_task})` : "";
    process.stderr.write(`MESSAGE from ${m.from_name}${task} at ${m.created_at}:\n  ${m.text.replace(/\n/g, "\n  ")}\n`);
  }
}

/** Dies unless .hq.json holds the claim (and so the attempt_id) for this task. */
function assertCurrent(cfg, id) {
  const cur = cfg.current;
  if (!cur || cur.task_id !== id) {
    die(`No saved claim for task ${id}${cur ? ` (current task is ${cur.task_id})` : ""}. Run: hq claim`);
  }
}

/** Mutation on the current task: sends the saved attempt_id; a 409 means the claim is gone. */
async function taskCall(cfg, id, action, body) {
  assertCurrent(cfg, id);
  const cur = cfg.current;
  try {
    return await api(cfg, "POST", `/api/tasks/${encodeURIComponent(id)}/${action}`, {
      attempt_id: cur.attempt_id, ...body,
    });
  } catch (err) {
    if (err.status === 409 || err.status === 404) {
      saveConfig({ ...cfg, current: null });
      err.message += "\nThis claim is no longer yours; cleared it from .hq.json. Run: hq claim";
    }
    throw err;
  }
}

// ---------- checks + git ----------

const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

function runChecks() {
  const results = {};
  let failed = null;
  for (const [name, cmd] of CHECKS) {
    process.stderr.write(`hq: running ${name} (${cmd})... `);
    const r = spawnSync(cmd, { shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const ok = r.status === 0;
    results[name] = ok;
    process.stderr.write(ok ? "ok\n" : `FAILED (exit ${r.status ?? r.signal ?? r.error?.message})\n`);
    if (!ok && !failed) {
      const out = stripAnsi(`${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`);
      failed = { name, tail: out.trimEnd().split(/\r?\n/).slice(-LOG_LINES).join("\n") };
    }
  }
  return { checks: results, failed };
}

function git(...args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    return die(`git ${args.join(" ")} failed: ${String(err.stderr || err.message).trim()}`);
  }
}

// ---------- commands ----------

const commands = {
  async join(argv) {
    const { values: v } = parseArgs({
      args: argv, options: {
        code: { type: "string" }, participant: { type: "string" }, name: { type: "string" },
        role: { type: "string" }, tool: { type: "string" }, model: { type: "string" }, machine: { type: "string" },
      },
    });
    const code = v.code ?? process.env.TEAM_JOIN_CODE;
    if (!code || !v.participant || !v.name) die("join needs --code, --participant and --name");
    const old = loadConfig({ required: false });
    const body = {
      code, participant: v.participant, name: v.name, machine: v.machine ?? hostname(),
      tool: v.tool, model: v.model, role: v.role,
    };
    const res = await api(old, "POST", "/api/agents/join", body, { auth: false });
    const sameAgent = old.agent_id === res.agent_id;
    saveConfig({
      url: baseUrl(old), agent_id: res.agent_id, participant_id: res.participant_id, token: res.token,
      name: v.name, role: v.role ?? "worker", current: sameAgent ? old.current ?? null : null,
    });
    console.log(`Joined as ${v.name} (agent ${res.agent_id}). Saved ${CONFIG}.`);
  },

  async claim(argv) {
    const { values: v } = parseArgs({ args: argv, options: { json: { type: "boolean" } } });
    const cfg = loadConfig();
    const res = await api(cfg, "POST", "/api/tasks/claim");
    if (!res.task) {
      saveConfig({ ...cfg, current: null });
      if (v.json) return console.log(JSON.stringify(res, null, 2));
      if (res.reason === "fairness") console.error("hq: skipped for fairness; a teammate's agent gets the next task");
      return console.log("NO_TASK");
    }
    const t = res.task;
    saveConfig({ ...cfg, current: { task_id: t.id, attempt_id: t.attempt_id, title: t.title, claimed_at: t.claimed_at } });
    if (v.json) return console.log(JSON.stringify(res, null, 2));
    const changes = res.since_last_claim ?? [];
    if (changes.length) {
      console.log("What changed since your last task:");
      for (const c of changes) console.log(`- ${c.title} [${c.id.slice(0, 6)}]${c.summary ? `: ${c.summary}` : ""}`);
      console.log("");
    }
    console.log(JSON.stringify(t, null, 2));
  },

  async progress(argv) {
    const [id, ...msg] = argv;
    const message = msg.join(" ").trim();
    if (!id || !message) die('Usage: hq progress <id> "message"');
    await taskCall(loadConfig(), id, "progress", { message });
    console.log("ok");
  },

  async review(argv) {
    const { values: v, positionals } = parseArgs({
      args: argv, allowPositionals: true, options: {
        pr: { type: "string" }, branch: { type: "string" }, summary: { type: "string" },
        "allow-failing": { type: "boolean" },
      },
    });
    const id = positionals[0];
    if (!id || !v.pr || !v.branch) die("Usage: hq review <id> --pr <url> --branch <branch> [--summary ...]");
    const cfg = loadConfig();
    assertCurrent(cfg, id); // before spending minutes on checks
    if (git("status", "--porcelain")) console.error("hq: warning: uncommitted changes; head_sha is the last commit");
    const head_sha = git("rev-parse", "HEAD");
    const { checks, failed } = runChecks();
    if (failed && !v["allow-failing"]) {
      console.error(`--- last ${LOG_LINES} lines of ${failed.name} ---\n${failed.tail}\n---`);
      die(`${failed.name} failed; not submitting. Fix it, or run: hq fail ${id} "<reason>"`);
    }
    await taskCall(cfg, id, "review", { pr_url: v.pr, branch: v.branch, head_sha, checks, summary: v.summary });
    saveConfig({ ...cfg, current: null });
    console.log(`Submitted for review at ${head_sha.slice(0, 7)} (lint ${checks.lint}, typecheck ${checks.typecheck}, build ${checks.build}).`);
  },

  async fail(argv) {
    const { values: v, positionals } = parseArgs({
      args: argv, allowPositionals: true, options: { "no-checks": { type: "boolean" } },
    });
    const [id, ...rest] = positionals;
    const reason = rest.join(" ").trim();
    if (!id || !reason) die('Usage: hq fail <id> "reason" [--no-checks]');
    const cfg = loadConfig();
    assertCurrent(cfg, id);
    let log_excerpt;
    if (!v["no-checks"]) {
      const { failed } = runChecks();
      if (failed) log_excerpt = `$ ${failed.name}\n${failed.tail}`;
    }
    await taskCall(cfg, id, "fail", { reason, log_excerpt });
    saveConfig({ ...cfg, current: null });
    console.log(`Marked failed${log_excerpt ? " (attached the failing check's log)" : ""}.`);
  },

  async status(argv) {
    const { values: v } = parseArgs({ args: argv, options: { json: { type: "boolean" } } });
    const cfg = loadConfig();
    const { token, ...safe } = cfg; // never print the token
    if (v.json) return console.log(JSON.stringify({ ...safe, url: baseUrl(cfg), has_token: Boolean(token) }, null, 2));
    console.log(`Agent:   ${cfg.name} (${cfg.agent_id}), role ${cfg.role ?? "worker"}`);
    console.log(`Server:  ${baseUrl(cfg)}`);
    console.log(cfg.current
      ? `Task:    ${cfg.current.title} (${cfg.current.task_id}), claimed ${cfg.current.claimed_at ?? "?"}`
      : "Task:    none");
  },

  async msg(argv) {
    const [target, ...rest] = argv;
    const text = rest.join(" ").trim();
    if (!target || !text) die('Usage: hq msg <agent|task> "text"');
    const cfg = loadConfig();
    // Agents first (id or name); a 404 means nothing was sent, so retry as a task id.
    let res;
    try {
      res = await api(cfg, "POST", "/api/messages", { to_agent: target, text });
    } catch (err) {
      if (err.status !== 404) throw err;
      try {
        res = await api(cfg, "POST", "/api/messages", { to_task: target, text });
      } catch (err2) {
        // 400 = not even a valid task id (e.g. a misspelled agent name with spaces).
        if (err2.status === 404 || err2.status === 400) die(`No agent or task "${target}"`);
        throw err2;
      }
    }
    console.log(`Sent to ${res.to_name}.`);
  },

  async inbox() {
    const res = await api(loadConfig(), "GET", "/api/messages");
    if (!res?.inbox?.length) console.log("No new messages.");
  },

  async "plan-requests"(argv) {
    const { values: v } = parseArgs({ args: argv, options: { json: { type: "boolean" }, wait: { type: "string" } } });
    const waitMs = Math.max(0, Number(v.wait ?? 0) * 1000);
    if (!Number.isFinite(waitMs)) die("--wait takes a number of seconds");
    const until = Date.now() + waitMs;
    let r;
    for (;;) {
      const res = await api(loadConfig(), "GET", "/api/plan-requests");
      [r] = res.requests ?? [];
      if (r || Date.now() + 30_000 > until) break;
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    if (v.json) return console.log(JSON.stringify(r ?? null, null, 2));
    if (!r) return console.log("NO_REQUEST");
    console.log(`PLAN REQUEST ${r.mission_id}
Title: ${r.title}
Requested by ${r.requested_by} at ${r.requested_at}
Goal:
${r.goal}
`);
    console.log(`Submit with: hq tasks add --mission ${r.mission_id} plan.json`);
  },

  async tasks(argv) {
    const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { mission: { type: "string" } } });
    const [sub, file] = positionals;
    if (sub !== "add" || !file) die("Usage: hq tasks add [--mission <id>] plan.json");
    let plan;
    try {
      plan = JSON.parse(readFileSync(file, "utf8"));
    } catch (err) {
      die(`Cannot read ${file}: ${err.message}`);
    }
    const body = Array.isArray(plan) ? { tasks: plan } : { ...plan };
    if (v.mission) body.mission_id = v.mission;
    const res = await api(loadConfig(), "POST", "/api/tasks", body);
    console.log(`Created ${res.ids.length} draft task(s):\n${res.ids.join("\n")}`);
  },
};

// ---------- main ----------

const [cmd, ...argv] = process.argv.slice(2);
if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  console.log(USAGE);
} else if (!commands[cmd]) {
  console.error(`hq: unknown command "${cmd}"\n\n${USAGE}`);
  process.exitCode = 2;
} else {
  try {
    await commands[cmd](argv);
  } catch (err) {
    const expected = err instanceof CliError || String(err?.code).startsWith("ERR_PARSE_ARGS");
    if (!expected) throw err;
    console.error(`hq: ${err.message}`);
    process.exitCode = 1;
  }
}
