-- supabase/migrations/20261027_ai_usage_and_plans.sql
-- Fair-use metering for the AI assistant, kept in the database so it is the
-- same for every running copy of the function and cannot be bypassed from
-- the app. Safe to run more than once.

-- 1) Who has a paid plan. A user without a row (or with an expired one) is on
--    the free plan.
create table if not exists public.user_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'pro')),
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_plans enable row level security;

drop policy if exists "user_plans_select_own" on public.user_plans;

create policy "user_plans_select_own"
  on public.user_plans
  for select
  to authenticated
  using (auth.uid() = user_id);

-- 2) How many AI messages each user used on each UTC day. No policies on
--    purpose: only the server (service role) reads and writes it.
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  messages integer not null default 0 check (messages >= 0),
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

-- 3) One atomic step: count this message if the user is still under the
--    limit of their plan. The limits are passed in by the function (secrets),
--    so they can be changed without touching the database.
create or replace function public.consume_ai_message(
  p_user uuid,
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
  v_day date := (now() at time zone 'utc')::date;
  v_used integer;
begin
  if p_user is null or p_free_limit < 0 or p_pro_limit < 0 then
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

  -- A limit of zero allows nothing, and nothing is counted.
  if v_quota = 0 then
    return query select false, 0, 0, v_plan;
    return;
  end if;

  insert into public.ai_usage as u (user_id, day, messages)
  values (p_user, v_day, 1)
  on conflict (user_id, day)
  do update set messages = u.messages + 1
  where u.messages < v_quota
  returning u.messages into v_used;

  if v_used is null then
    select u.messages
      into v_used
      from public.ai_usage u
     where u.user_id = p_user
       and u.day = v_day;

    return query select false, coalesce(v_used, 0), v_quota, v_plan;
  else
    return query select true, v_used, v_quota, v_plan;
  end if;
end;
$$;

revoke all on function public.consume_ai_message(uuid, integer, integer) from public;
revoke all on function public.consume_ai_message(uuid, integer, integer) from anon;
revoke all on function public.consume_ai_message(uuid, integer, integer) from authenticated;
grant execute on function public.consume_ai_message(uuid, integer, integer) to service_role;
