-- ============================================================
-- Women's tables — mirrors of the men's table schema with a `w_` prefix.
-- Run this ONCE in the Supabase SQL Editor before running
-- `import_w_torvik.py`.
--
-- Why `LIKE … INCLUDING ALL`: copies columns, defaults, NOT NULL,
-- CHECK constraints, PKs, indexes, and storage params. It does NOT
-- copy foreign keys, RLS policies, or triggers — re-add those by
-- hand after this runs, mirroring whatever the men's-side has in
-- Supabase Studio.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.w_players                       (LIKE public.players                       INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_player_stats                  (LIKE public.player_stats                  INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_portal_transfers              (LIKE public.portal_transfers              INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_team_players                  (LIKE public.team_players                  INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_custom_roster_players         (LIKE public.custom_roster_players         INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_saved_rosters                 (LIKE public.saved_rosters                 INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_international_players         (LIKE public.international_players         INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_international_players_stats   (LIKE public.international_players_stats   INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_international_players_splits  (LIKE public.international_players_splits  INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public.w_international_tier_labels     (LIKE public.international_tier_labels     INCLUDING ALL);

-- ── Unique constraint the importer relies on for upserts ─────────────────────
-- The men's scraper uses on_conflict="name,current_team,source". `LIKE`
-- copied the index but not the unique constraint name; re-declare it:
ALTER TABLE public.w_players
  DROP CONSTRAINT IF EXISTS w_players_name_current_team_source_key;
ALTER TABLE public.w_players
  ADD CONSTRAINT w_players_name_current_team_source_key
  UNIQUE (name, current_team, source);

-- w_player_stats matches its men's twin: one row per (player_id, year).
ALTER TABLE public.w_player_stats
  DROP CONSTRAINT IF EXISTS w_player_stats_player_id_year_key;
ALTER TABLE public.w_player_stats
  ADD CONSTRAINT w_player_stats_player_id_year_key
  UNIQUE (player_id, year);

-- ── vw_w_players view ────────────────────────────────────────────────────────
-- The men's `vw_players` view was hand-built in Supabase Studio and isn't
-- captured in this repo, so `LIKE` can't copy it. After this script runs:
--   1) Open Supabase Studio → Database → Views → vw_players → "Definition"
--   2) Copy the SQL, paste it below, rename `vw_players` → `vw_w_players`,
--      and swap every `players` / `player_stats` reference to `w_players`
--      / `w_player_stats`.
--   3) Run it. The frontend's `useWomensRosterBoard` already targets it.

-- ── PostgREST schema reload so the new tables show up over REST ──────────────
NOTIFY pgrst, 'reload schema';
