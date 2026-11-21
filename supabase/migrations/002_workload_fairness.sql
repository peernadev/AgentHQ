-- 002: drop credit tracking, fairness by workload points (S=1, M=2, L=4).
-- Run once in Supabase SQL Editor if you already ran the original schema.sql.

alter table participants drop column if exists credit_budget, drop column if exists credits_remaining;
alter table tasks        drop column if exists est_credits,   drop column if exists credits_used;

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

revoke execute on function claim_next_task(uuid) from public, anon, authenticated;
grant select on participant_workload to anon, authenticated;
