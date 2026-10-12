-- WATAFITI security hardening v3
-- Run this in Supabase Dashboard > SQL Editor.
-- Limits top-page analytics RPC output to authorized WATAFITI admins.

create or replace function public.get_top_pages()
returns table(page text, visits bigint)
language sql
security definer
set search_path = ''
as $$
  select ve.page, count(*)::bigint as visits
  from public.visitor_events ve
  where exists (
    select 1
    from public.admin_users au
    where au.user_id = auth.uid()
  )
  group by ve.page
  order by count(*) desc
  limit 10;
$$;

revoke all on function public.get_top_pages() from public;
grant execute on function public.get_top_pages() to authenticated;
