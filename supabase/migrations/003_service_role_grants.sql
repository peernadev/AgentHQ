-- 003: let the server (secret key = service_role) use the tables and claim functions.
-- New Supabase projects no longer grant service_role access to tables created in the
-- SQL Editor, and revoking execute from public removed its access to the functions.
-- Run once in Supabase SQL Editor if you already ran schema.sql (and 002).

grant select, insert, update, delete on participants, agents, agent_tokens, tasks, events to service_role;
grant select on participant_workload to service_role;
grant usage, select on all sequences in schema public to service_role;   -- events.id bigserial
grant execute on function claim_next_task(uuid), release_stale_tasks() to service_role;

-- Tables and sequences created later get the same access.
alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;
