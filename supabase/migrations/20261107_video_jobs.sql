-- supabase/migrations/20261107_video_jobs.sql
-- Foundation of the video generation engine:
--   1) video_jobs      the job queue and the user's video history, with the
--                      status, progress, retry, result, cost and credit
--                      bookkeeping of every video
--   2) video_usage     the monthly video-credit meter of every user
--   3) credit functions  atomic "charge" and "give back" steps (server only)
--   4) storage         a private bucket for the finished videos
-- Everything is written by the server (service role). The app can only read
-- its own jobs and its own files. Safe to run more than once.

-- 1) Jobs --------------------------------------------------------------------

create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The chat the video was asked in. No foreign key on purpose: deleting a
  -- chat must never delete the person's videos.
  conversation_id uuid,
  -- Made by the app once per request and kept across retries, so a repeated
  -- request (weak internet) can never start a second video or charge twice.
  client_request_id uuid not null,
  -- The video this one continues, refines or is a variant of.
  parent_job_id uuid references public.video_jobs (id) on delete set null,
  kind text not null
    check (kind in ('text_to_video', 'image_to_video', 'multi_image_to_video')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed', 'canceled')),
  progress smallint not null default 0 check (progress between 0 and 100),
  -- What the person wrote, and the professional prompt the AI made from it.
  user_prompt text not null check (char_length(user_prompt) between 1 and 8000),
  engine_prompt text
    check (engine_prompt is null or char_length(engine_prompt) <= 8000),
  style text not null default 'auto'
    check (style in ('auto', 'realistic', 'cinematic', 'animation', 'advertising', 'educational')),
  aspect_ratio text not null default '16:9'
    check (aspect_ratio in ('16:9', '9:16', '1:1')),
  duration_seconds smallint not null default 5
    check (duration_seconds between 1 and 60),
  quality text not null default 'standard'
    check (quality in ('draft', 'standard', 'high')),
  -- Settings that only some engines understand (seed, negative prompt, ...).
  params jsonb not null default '{}'::jsonb
    check (jsonb_typeof(params) = 'object'),
  -- Storage paths (in the "videos" bucket) of the pictures to animate.
  source_image_paths text[] not null default '{}',
  -- Which engine and model made it, and the engine's own job id.
  provider text,
  model text,
  provider_job_id text,
  -- Retry bookkeeping.
  attempts smallint not null default 0 check (attempts >= 0),
  max_attempts smallint not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  -- The result: paths in the "videos" bucket, always inside the owner's folder.
  result_path text,
  thumbnail_path text,
  result_duration_seconds numeric(6, 2) check (result_duration_seconds >= 0),
  error_code text,
  error_message text,
  -- What it cost: the credits taken from the person, and the real money cost
  -- (millionths of a US dollar) when the engine reports it.
  credits_charged integer not null default 0 check (credits_charged >= 0),
  cost_micro_usd bigint not null default 0 check (cost_micro_usd >= 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),

  constraint video_jobs_request_unique unique (user_id, client_request_id),
  -- The pictures must match the kind of video.
  constraint video_jobs_sources_match_kind check (
    (kind = 'text_to_video' and cardinality(source_image_paths) = 0)
    or (kind = 'image_to_video' and cardinality(source_image_paths) = 1)
    or (kind = 'multi_image_to_video'
        and cardinality(source_image_paths) between 2 and 10)
  ),
  -- A finished video always has its file, and a failed one always has a reason.
  constraint video_jobs_succeeded_has_result check (
    status <> 'succeeded' or result_path is not null
  ),
  constraint video_jobs_failed_has_reason check (
    status <> 'failed' or error_code is not null
  ),
  -- Files live in the owner's own folder: <user id>/<job id>/...
  constraint video_jobs_result_in_own_folder check (
    result_path is null or result_path like user_id::text || '/%'
  ),
  constraint video_jobs_thumbnail_in_own_folder check (
    thumbnail_path is null or thumbnail_path like user_id::text || '/%'
  )
);

create index if not exists video_jobs_user_created_idx
  on public.video_jobs (user_id, created_at desc);

-- The queue: jobs waiting for their turn.
create index if not exists video_jobs_queue_idx
  on public.video_jobs (next_attempt_at)
  where status = 'queued';

-- Jobs being worked on whose lease ran out (the worker stopped) are found here.
create index if not exists video_jobs_lease_idx
  on public.video_jobs (locked_until)
  where status = 'processing';

create index if not exists video_jobs_parent_idx
  on public.video_jobs (parent_job_id)
  where parent_job_id is not null;

create or replace function public.video_jobs_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists video_jobs_set_updated_at on public.video_jobs;

create trigger video_jobs_set_updated_at
  before update on public.video_jobs
  for each row
  execute function public.video_jobs_set_updated_at();

alter table public.video_jobs enable row level security;

-- The app may only read its own jobs. Creating and changing jobs is done by
-- the server alone, so nothing here can be forged from the browser.
drop policy if exists "video_jobs_select_own" on public.video_jobs;

create policy "video_jobs_select_own"
  on public.video_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);

grant select on public.video_jobs to authenticated;
grant all on public.video_jobs to service_role;

-- 2) Monthly video credits ---------------------------------------------------

-- How many video credits each user used in each UTC month. No policies on
-- purpose: only the server (service role) reads and writes it.
create table if not exists public.video_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  credits integer not null default 0 check (credits >= 0),
  jobs integer not null default 0 check (jobs >= 0),
  primary key (user_id, month)
);

alter table public.video_usage enable row level security;

grant all on public.video_usage to service_role;

-- 3) Credit functions --------------------------------------------------------

-- One atomic step: take p_cost credits if the user's plan still has room this
-- month. The limits are passed in by the function (secrets), so the prices of
-- the plans can change without touching the database. Same plans as the
-- AI-message meter (user_plans: free / pro).
create or replace function public.consume_video_credits(
  p_user uuid,
  p_cost integer,
  p_free_limit integer,
  p_pro_limit integer
)
returns table (allowed boolean, used integer, quota integer, plan text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text := 'free';
  v_quota integer;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_used integer;
begin
  if p_user is null or p_cost is null or p_cost <= 0
     or p_free_limit is null or p_free_limit < 0
     or p_pro_limit is null or p_pro_limit < 0 then
    raise exception 'invalid arguments';
  end if;

  select up.plan
    into v_plan
    from public.user_plans up
   where up.user_id = p_user
     and up.plan = 'pro'
     and (up.expires_at is null or up.expires_at > now());

  v_plan := coalesce(v_plan, 'free');
  v_quota := case when v_plan = 'pro' then p_pro_limit else p_free_limit end;

  -- A video that costs more than the whole month's room can never be allowed,
  -- and nothing is counted. (The insert below would otherwise skip the check
  -- for a user's very first video of the month.)
  if p_cost > v_quota then
    select u.credits
      into v_used
      from public.video_usage u
     where u.user_id = p_user
       and u.month = v_month;

    return query select false, coalesce(v_used, 0), v_quota, v_plan;
    return;
  end if;

  insert into public.video_usage as u (user_id, month, credits, jobs)
  values (p_user, v_month, p_cost, 1)
  on conflict (user_id, month)
  do update set credits = u.credits + p_cost, jobs = u.jobs + 1
  where u.credits + p_cost <= v_quota
  returning u.credits into v_used;

  if v_used is null then
    select u.credits
      into v_used
      from public.video_usage u
     where u.user_id = p_user
       and u.month = v_month;

    return query select false, coalesce(v_used, 0), v_quota, v_plan;
  else
    return query select true, v_used, v_quota, v_plan;
  end if;
end;
$$;

-- Gives back the credits of a video that could not be made, so the person is
-- not charged for it. p_charged_at is when the credits were taken (the job's
-- creation time), so the right month is credited even after midnight of the
-- month's last day.
create or replace function public.refund_video_credits(
  p_user uuid,
  p_cost integer,
  p_charged_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_cost is null or p_cost <= 0 or p_charged_at is null then
    raise exception 'invalid arguments';
  end if;

  update public.video_usage u
     set credits = greatest(u.credits - p_cost, 0),
         jobs = greatest(u.jobs - 1, 0)
   where u.user_id = p_user
     and u.month = date_trunc('month', p_charged_at at time zone 'utc')::date;
end;
$$;

revoke all on function public.consume_video_credits(uuid, integer, integer, integer) from public;
revoke all on function public.consume_video_credits(uuid, integer, integer, integer) from anon;
revoke all on function public.consume_video_credits(uuid, integer, integer, integer) from authenticated;
grant execute on function public.consume_video_credits(uuid, integer, integer, integer) to service_role;

revoke all on function public.refund_video_credits(uuid, integer, timestamptz) from public;
revoke all on function public.refund_video_credits(uuid, integer, timestamptz) from anon;
revoke all on function public.refund_video_credits(uuid, integer, timestamptz) from authenticated;
grant execute on function public.refund_video_credits(uuid, integer, timestamptz) to service_role;

-- 4) Storage -----------------------------------------------------------------

-- A private bucket. Files are named <user id>/<job id>/video.mp4 (and
-- thumb.jpg). The server writes them; the app can only read its own folder,
-- through short-lived signed links. The 50 MB limit is the largest file the
-- free Supabase plan accepts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'videos',
  'videos',
  false,
  52428800,
  array['video/mp4', 'video/webm', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "videos_select_own" on storage.objects;

create policy "videos_select_own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'videos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
