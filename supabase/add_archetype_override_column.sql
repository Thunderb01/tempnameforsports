-- ============================================================
-- Add the missing archetype_override column on public.players.
--
-- AdminPage.jsx's PlayerEditForm has written to `archetype_override`
-- (jsonb: null | string[]) as the replacement for the legacy single-value
-- `archetype_overwrite` (text) since the archetype multi-override UI was
-- built, but the column itself was never actually created on the live
-- table. Every full-form save (Edit modal) failed with:
--   "Could not find the 'archetype_override' column of 'players' in the
--    schema cache"
-- because PostgREST rejects the whole PATCH when any field in it doesn't
-- match a real column — so unrelated fields in the same save, including
-- player_status, silently never got applied either.
--
-- Safe to run more than once.
-- ============================================================

alter table public.players add column if not exists archetype_override jsonb;

notify pgrst, 'reload schema';
