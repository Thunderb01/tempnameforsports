-- ============================================================
-- Beyond the Portal — Superadmin access to the coaches table
-- Run this entire file in: Supabase dashboard → SQL Editor.
--
-- `coaches` has only ever had "Coaches read own row" (schema.sql):
--     using (auth.uid() = user_id)
-- which is correct for a regular coach, but it also silently applies
-- to superadmins — so the /admin → Coaches tab (AdminPage.jsx
-- CoachesTab) only ever lists the signed-in superadmin's own row, and
-- its role-change dropdown has no UPDATE policy to write through at
-- all. This adds the missing superadmin grant (select/insert/update/
-- delete), mirroring the same "Superadmin manages X" pattern already
-- used for archetype_defs, freshman_tiers, team_freshmen, news, and
-- international_tier_labels.
--
-- Multiple permissive policies for the same command are OR'd together
-- in Postgres, so this is additive: the existing "own row" policy still
-- applies for plain coaches, and a superadmin's own row is still
-- readable via that policy while their EXISTS(...) subquery below
-- resolves — no circular lockout.
-- ============================================================

drop policy if exists "Superadmin manages coaches" on public.coaches;
create policy "Superadmin manages coaches"
  on public.coaches for all
  using      (exists (select 1 from public.coaches c where c.user_id = auth.uid() and c.role = 'superadmin'))
  with check (exists (select 1 from public.coaches c where c.user_id = auth.uid() and c.role = 'superadmin'));
