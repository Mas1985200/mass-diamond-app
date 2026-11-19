-- supabase/migrations/20261119_video_worker_tasks.sql
-- The queue of Mass Diamond's own video workers. The self-worker engine puts a
-- task here; any number of workers (each on its own GPU) take tasks one by one,
-- make the video and put it in the "videos" bucket. A worker that stops in the
-- middle loses its lease and the task goes to another worker. Server only.
-- Safe to run more than once.

create table if not exists public.video_worker_tasks (
  id uuid primary key default gen_random_uuid(),
  request jsonb not null check (jsonb_typeof(request) = 'object'),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed')),
  progress smallint not null default 0 check (progress between 0 and 100),
  worker_id text check (worker_id is null or char_length(worker_id) between 1 and 100),
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  result_path text check (result_path is null or result_path like 'worker/%'),
  result_duration_seconds numeric(6, 2) check (result_duration_seconds >= 0),
  error_code text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint video_worker_tasks_succeeded_has_result check (
    status <> 'succeeded' or result_path is not null
  ),
  constraint video_worker_tasks_failed_has_reason check (
    status <> 'failed' or error_code is not null
  )
);

create index if not exists video_worker_tasks_queue_idx
  on public.video_worker_tasks (created_at)
  where status = 'queued';

create index if not exists video_worker_tasks_lease_idx
  on public.video_worker_tasks (locked_until)
  where status = 'processing';

alter table public.video_worker_tasks enable row level security;

grant all on public.video_worker_tasks to service_role;

-- A worker asks for its next task. Tasks whose worker stopped (lease over) are
-- given again; a task with no tries left is ended as failed instead.
create or replace function public.claim_video_worker_task(
  p_worker text,
  p_lease_seconds integer default 600
)
returns setof public.video_worker_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_worker is null or char_length(p_worker) not between 1 and 100
     or p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid arguments';
  end if;

  update public.video_worker_tasks t
     set status = 'failed',
         error_code = 'worker_lost',
         error_message = 'The worker stopped and no tries are left.',
         completed_at = now(),
         locked_until = null,
         updated_at = now()
   where t.status = 'processing'
     and t.locked_until < now()
     and t.attempts >= t.max_attempts;

  select t.id
    into v_id
    from public.video_worker_tasks t
   where (t.status = 'queued' and t.next_attempt_at <= now())
      or (t.status = 'processing' and t.locked_until < now()
          and t.attempts < t.max_attempts)
   order by t.created_at
   limit 1
   for update skip locked;

  if v_id is null then
    return;
  end if;

  return query
  update public.video_worker_tasks t
     set status = 'processing',
         worker_id = p_worker,
         attempts = t.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         started_at = coalesce(t.started_at, now()),
         progress = greatest(t.progress, 1),
         updated_at = now()
   where t.id = v_id
   returning t.*;
end;
$$;

-- The worker reports progress and keeps its lease. False when the task is no
-- longer this worker's (it should stop).
create or replace function public.progress_video_worker_task(
  p_task uuid,
  p_worker text,
  p_progress integer,
  p_lease_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_task is null or p_worker is null or p_progress is null
     or p_progress not between 0 and 99
     or p_lease_seconds is null or p_lease_seconds not between 30 and 3600 then
    raise exception 'invalid arguments';
  end if;

  update public.video_worker_tasks t
     set progress = greatest(t.progress, p_progress),
         locked_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where t.id = p_task
     and t.worker_id = p_worker
     and t.status = 'processing';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- The worker finished: the video is in the bucket at p_result_path.
create or replace function public.complete_video_worker_task(
  p_task uuid,
  p_worker text,
  p_result_path text,
  p_duration numeric
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_task is null or p_worker is null or p_result_path is null
     or p_result_path not like 'worker/%' or p_duration is null or p_duration < 0 then
    raise exception 'invalid arguments';
  end if;

  update public.video_worker_tasks t
     set status = 'succeeded',
         progress = 100,
         result_path = p_result_path,
         result_duration_seconds = p_duration,
         completed_at = now(),
         locked_until = null,
         error_code = null,
         error_message = null,
         updated_at = now()
   where t.id = p_task
     and t.worker_id = p_worker
     and t.status = 'processing';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

-- The worker could not make the video. A retryable failure goes back to the
-- queue (another worker may take it) while tries remain.
create or replace function public.fail_video_worker_task(
  p_task uuid,
  p_worker text,
  p_code text,
  p_message text,
  p_retryable boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer;
begin
  if p_task is null or p_worker is null or p_code is null or p_retryable is null then
    raise exception 'invalid arguments';
  end if;

  update public.video_worker_tasks t
     set status = case
           when p_retryable and t.attempts < t.max_attempts then 'queued'
           else 'failed'
         end,
         progress = case
           when p_retryable and t.attempts < t.max_attempts then 0
           else t.progress
         end,
         next_attempt_at = case
           when p_retryable and t.attempts < t.max_attempts
             then now() + make_interval(secs => 30 * t.attempts)
           else t.next_attempt_at
         end,
         error_code = p_code,
         error_message = left(coalesce(p_message, ''), 500),
         completed_at = case
           when p_retryable and t.attempts < t.max_attempts then null
           else now()
         end,
         locked_until = null,
         updated_at = now()
   where t.id = p_task
     and t.worker_id = p_worker
     and t.status = 'processing';

  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;

revoke all on function public.claim_video_worker_task(text, integer) from public, anon, authenticated;
revoke all on function public.progress_video_worker_task(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.complete_video_worker_task(uuid, text, text, numeric) from public, anon, authenticated;
revoke all on function public.fail_video_worker_task(uuid, text, text, text, boolean) from public, anon, authenticated;

grant execute on function public.claim_video_worker_task(text, integer) to service_role;
grant execute on function public.progress_video_worker_task(uuid, text, integer, integer) to service_role;
grant execute on function public.complete_video_worker_task(uuid, text, text, numeric) to service_role;
grant execute on function public.fail_video_worker_task(uuid, text, text, text, boolean) to service_role;
