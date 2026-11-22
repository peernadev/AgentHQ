-- AgentHQ schema. Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Owner: B. Changes to this file are a shared-file change (announce first).

create extension if not exists pgcrypto;

-- ---------- tables ----------

create table participants (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  color             text,
  created_at        timestamptz not null default now()
);

create table agents (
  id              uuid primary key default gen_random_uuid(),
  participant_id  uuid not null references participants(id) on delete cascade,
  name            text not null unique,    -- e.g. "eran-mbp-1"
  machine         text,
  tool            text not null default 'codex',
  model           text,
  role            text not null default 'worker' check (role in ('worker','orchestrator')),
  status          text not null default 'idle' check (status in ('idle','working','blocked','offline')),
  current_task_id uuid,
  note            text,
  last_heartbeat  timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table agent_tokens (               -- no RLS policies: browser can never read this
  agent_id   uuid primary key references agents(id) on delete cascade,
  token_hash text not null unique         -- sha256 hex of the token
);

create table tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text not null,
  acceptance     text,
  priority       integer not null default 100,   -- lower = sooner
  size           text not null default 'M' check (size in ('S','M','L')),
  scope          text[] not null default '{}',   -- path prefixes this task may edit
  depends_on     uuid[] not null default '{}',
  status         text not null default 'draft'
                 check (status in ('draft','queued','claimed','in_progress','in_review','done','failed','cancelled')),
  agent_id       uuid references agents(id) on delete set null,
  branch         text,
  pr_url         text,
  result_summary text,
  created_by     text not null default 'orchestrator',
  claimed_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint queued_tasks_need_scope check (status = 'draft' or cardinality(scope) > 0)
);

alter table agents
  add constraint agents_current_task_fk foreign key (current_task_id) references tasks(id) on delete set null;

create table events (
  id         bigserial primary key,
  task_id    uuid references tasks(id) on delete set null,
  agent_id   uuid references agents(id) on delete set null,
  type       text not null,   -- created, approved, claimed, progress, pr_opened, done, failed, released, fairness_skip
  message    text,
  data       jsonb,
  created_at timestamptz not null default now()
);

create index on tasks (status, priority, created_at);
create index on events (created_at desc);

-- ---------- helpers ----------

-- Two scopes overlap if any prefix of one starts with a prefix of the other.
-- e.g. 'src/components/' overlaps 'src/components/queue/'.
create or replace function scopes_overlap(a text[], b text[])
returns boolean language sql immutable as $$
  select exists (
    select 1 from unnest(a) x, unnest(b) y
    where starts_with(x, y) or starts_with(y, x)
  );
$$;

-- Agents silent for 10 minutes go offline; their unfinished tasks return to the queue.
create or replace function release_stale_tasks()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update agents set status = 'offline'
   where status <> 'offline' and last_heartbeat < now() - interval '10 minutes';

  insert into events (task_id, agent_id, type, message)
  select id, agent_id, 'released', 'Agent went offline; task returned to queue'
    from tasks
   where status in ('claimed','in_progress')
     and agent_id in (select id from agents where status = 'offline');

  update tasks
     set status = 'queued', agent_id = null, claimed_at = null, updated_at = now()
   where status in ('claimed','in_progress')
     and agent_id in (select id from agents where status = 'offline');
  get diagnostics n = row_count;

  update agents set current_task_id = null where status = 'offline' and current_task_id is not null;
  return n;
end $$;

-- Atomically give an agent the best claimable task. Returns 0 or 1 rows.
-- Workload points per size, used for fairness.
create or replace function task_points(p_size text)
returns integer language sql immutable as $$
  select case p_size when 'S' then 1 when 'L' then 4 else 2 end;
$$;

-- Points of work each participant has taken (active + done).
create or replace view participant_workload as
select p.id as participant_id, p.name,
       coalesce(sum(task_points(t.size)) filter (where t.status in ('claimed','in_progress','in_review','done')), 0)::int as points,
       count(t.id) filter (where t.status = 'done')::int as tasks_done
  from participants p
  left join agents a on a.participant_id = p.id
  left join tasks t on t.agent_id = a.id
 group by p.id, p.name;

-- Atomically give an agent the best claimable task. Returns 0 or 1 rows.
create or replace function claim_next_task(p_agent_id uuid)
returns setof tasks language plpgsql security definer set search_path = public as $$
declare
  v_participant uuid;
  v_my_points   numeric;
  v_avg_points  numeric;
  v_task        tasks;
begin
  -- serialize all claims so two agents can never race for overlapping scopes
  perform pg_advisory_xact_lock(hashtext('claim_next_task'));
  perform release_stale_tasks();

  update agents set last_heartbeat = now(),
                    status = case when status = 'offline' then 'idle' else status end
   where id = p_agent_id
  returning participant_id into v_participant;
  if v_participant is null then raise exception 'unknown agent'; end if;

  if exists (select 1 from tasks where agent_id = p_agent_id and status in ('claimed','in_progress')) then
    raise exception 'agent already has an active task';
  end if;

  -- fairness: if you're more than 2 points ahead of the team average while a
  -- teammate has an idle worker, skip this round so the work spreads evenly.
  -- Average is over participants with a worker agent online.
  select points into v_my_points from participant_workload where participant_id = v_participant;
  select avg(w.points) into v_avg_points
    from participant_workload w
   where exists (select 1 from agents a where a.participant_id = w.participant_id
                   and a.role = 'worker' and a.last_heartbeat > now() - interval '10 minutes');
  if v_my_points > coalesce(v_avg_points, 0) + 2 and exists (
       select 1 from agents a
        where a.participant_id <> v_participant and a.role = 'worker'
          and a.status = 'idle' and a.last_heartbeat > now() - interval '10 minutes') then
    insert into events (agent_id, type, message)
    values (p_agent_id, 'fairness_skip', 'Ahead of the team on workload; leaving the next task for a teammate');
    update agents set status = 'idle', current_task_id = null where id = p_agent_id;
    return;
  end if;

  select q.* into v_task
    from tasks q
   where q.status = 'queued'
     and not exists (select 1 from tasks d where d.id = any(q.depends_on) and d.status <> 'done')
     and not exists (select 1 from tasks a
                      where a.status in ('claimed','in_progress','in_review')
                        and scopes_overlap(a.scope, q.scope))
   order by q.priority, q.created_at
   limit 1
   for update skip locked;

  if not found then
    update agents set status = 'idle', current_task_id = null where id = p_agent_id;
    return;
  end if;

  update tasks set status = 'claimed', agent_id = p_agent_id, claimed_at = now(), updated_at = now()
   where id = v_task.id
  returning * into v_task;

  update agents set status = 'working', current_task_id = v_task.id where id = p_agent_id;
  insert into events (task_id, agent_id, type, message) values (v_task.id, p_agent_id, 'claimed', v_task.title);
  return next v_task;
end $$;

-- Only the server (service role / secret key) may call these.
revoke execute on function release_stale_tasks()   from public, anon, authenticated;
revoke execute on function claim_next_task(uuid)    from public, anon, authenticated;

-- ---------- security: browser can read, never write ----------

alter table participants enable row level security;
alter table agents       enable row level security;
alter table agent_tokens enable row level security;
alter table tasks        enable row level security;
alter table events       enable row level security;

create policy "read participants" on participants for select to anon, authenticated using (true);
create policy "read agents"       on agents       for select to anon, authenticated using (true);
create policy "read tasks"        on tasks        for select to anon, authenticated using (true);
create policy "read events"       on events       for select to anon, authenticated using (true);
-- agent_tokens: intentionally no policies.
grant select on participants, agents, tasks, events, participant_workload to anon, authenticated;
revoke all on agent_tokens from anon, authenticated;

-- ---------- server access (secret key = service_role) ----------
-- New Supabase projects don't grant service_role access to tables created here.
grant select, insert, update, delete on participants, agents, agent_tokens, tasks, events to service_role;
grant select on participant_workload to service_role;
grant usage, select on all sequences in schema public to service_role;   -- events.id bigserial
grant execute on function claim_next_task(uuid), release_stale_tasks() to service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- ---------- realtime for the live dashboard ----------
alter publication supabase_realtime add table participants, agents, tasks, events;
