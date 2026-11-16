-- WATAFITI AI: privacy-conscious request rate limiting.
-- Run this file once in the Supabase SQL Editor before deploying the Edge Function.

create table if not exists public.watafiti_ai_rate_limits (
  ip_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0
);

alter table public.watafiti_ai_rate_limits enable row level security;
revoke all on table public.watafiti_ai_rate_limits from anon, authenticated;
grant all on table public.watafiti_ai_rate_limits to service_role;

create or replace function public.check_watafiti_ai_rate_limit(
  p_ip_hash text,
  p_limit integer default 12,
  p_window_seconds integer default 900
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  if p_ip_hash is null or length(p_ip_hash) < 32
     or p_limit < 1 or p_limit > 100
     or p_window_seconds < 60 or p_window_seconds > 3600 then
    return false;
  end if;

  insert into public.watafiti_ai_rate_limits as limits (ip_hash, window_started_at, request_count)
  values (p_ip_hash, now(), 1)
  on conflict (ip_hash) do update
    set window_started_at = case
          when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
          else limits.window_started_at
        end,
        request_count = case
          when limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
          else limits.request_count + 1
        end
  returning request_count into current_count;

  delete from public.watafiti_ai_rate_limits
  where window_started_at < now() - interval '2 days';

  return current_count <= p_limit;
end;
$$;

revoke all on function public.check_watafiti_ai_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_watafiti_ai_rate_limit(text, integer, integer) to service_role;
