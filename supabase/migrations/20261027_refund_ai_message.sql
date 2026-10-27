-- supabase/migrations/20261027_refund_ai_message.sql
-- Gives back one counted AI message when the assistant could not answer
-- (for example the AI service was busy), so the user is not charged for it.
-- Safe to run more than once.

create or replace function public.refund_ai_message(p_user uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_usage u
     set messages = greatest(u.messages - 1, 0)
   where u.user_id = p_user
     and u.day = (now() at time zone 'utc')::date;
$$;

revoke all on function public.refund_ai_message(uuid) from public;
revoke all on function public.refund_ai_message(uuid) from anon;
revoke all on function public.refund_ai_message(uuid) from authenticated;
grant execute on function public.refund_ai_message(uuid) to service_role;
