-- ============================================================
-- Overall (multi-season) ratings — cdi_overall/dds_overall/sei_overall/
-- ath_overall/ris_overall/nil_valuation_overall on players/w_players.
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- A player's season-by-season cdi/dds/sei/ath/ris already live on
-- player_stats/w_player_stats (one row per player_id + calendar_year) and
-- stay exactly as they are -- these new columns hold a SEPARATE, weighted
-- blend of the current season plus however many prior seasons exist, so
-- a proven track record carries weight without losing any single season's
-- real number. torvik_metrics.py/torvik_metrics_w.py compute and write
-- these every run (see CLAUDE.md's "Overall rating" section); nothing
-- else writes them.
--
-- Weights by career length (current season first): 1 season -> 100%;
-- 2 -> 70/30; 3 -> 70/20/10; 4+ -> 70/15/10/5 (anything beyond 4 seasons
-- is dropped from the blend, not extrapolated into a 5th tier).
--
-- nil_valuation also gets added to player_stats/w_player_stats here --
-- it previously only ever lived on players.nil_valuation (overwritten
-- every run, no history). Capturing it per-season starting now is what
-- lets nil_valuation_overall actually have something to blend once a
-- couple of seasons pass; it has nothing to draw on retroactively for
-- seasons before this column existed, beyond whatever
-- season_board_archive/w_season_board_archive happened to capture for an
-- already-archived season.
-- ============================================================

alter table public.players   add column if not exists cdi_overall           numeric;
alter table public.players   add column if not exists dds_overall           numeric;
alter table public.players   add column if not exists sei_overall           numeric;
alter table public.players   add column if not exists ath_overall           numeric;
alter table public.players   add column if not exists ris_overall           numeric;
alter table public.players   add column if not exists nil_valuation_overall numeric;

alter table public.w_players add column if not exists cdi_overall           numeric;
alter table public.w_players add column if not exists dds_overall           numeric;
alter table public.w_players add column if not exists sei_overall           numeric;
alter table public.w_players add column if not exists ath_overall           numeric;
alter table public.w_players add column if not exists ris_overall           numeric;
alter table public.w_players add column if not exists nil_valuation_overall numeric;

alter table public.player_stats   add column if not exists nil_valuation numeric;
alter table public.w_player_stats add column if not exists nil_valuation numeric;

notify pgrst, 'reload schema';
