-- ============================================================
-- Beyond the Portal — Fix infinite-recursion RLS bug on coaches
-- Run this entire file in: Supabase dashboard → SQL Editor.
--
-- supabase/coaches_admin_access.sql (previous migration) added:
--
--   create policy "Superadmin manages coaches"
--     on public.coaches for all
--     using (exists (select 1 from public.coaches c where c.user_id = auth.uid() and c.role = 'superadmin'))
--     ...
--
-- This self-references `coaches` from a policy defined ON `coaches`.
-- Every other "Superadmin manages X" policy in this repo checks
-- `coaches` from a DIFFERENT table's policy (archetype_defs,
-- freshman_tiers, team_freshmen, news, international_tier_labels) —
-- that's fine, it's a normal cross-table lookup. Doing it from
-- coaches' OWN policy is a well-known Postgres/Supabase footgun:
-- evaluating the policy requires querying coaches, which requires
-- re-evaluating the same policy set, and Postgres's planner throws
-- `infinite recursion detected in policy for relation "coaches"`
-- (42P17) rather than resolving it — regardless of the fact that the
-- pre-existing "Coaches read own row" policy logically provides a
-- base case. That error makes EVERY query against `coaches` fail,
-- including a user's own profile fetch on login — which silently
-- drops `profile` to null and takes every role-gated UI element
-- (Admin link, M/W toggle) down with it, not just superadmin-only
-- features.
--
-- Fix: move the check into a SECURITY DEFINER function. Those run
-- with the privileges of the function owner, bypassing RLS on the
-- query INSIDE the function — so the policy no longer has to
-- re-evaluate itself to answer "is this user a superadmin".
-- ============================================================

drop policy if exists "Superadmin manages coaches" on public.coaches;

create or replace function public.is_superadmin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.coaches
    where user_id = auth.uid() and role = 'superadmin'
  );
$$;

create policy "Superadmin manages coaches"
  on public.coaches for all
  using      (public.is_superadmin())
  with check (public.is_superadmin());
