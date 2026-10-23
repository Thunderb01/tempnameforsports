-- ============================================================
-- on_board — whether a player currently belongs on the live Full Board
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- archive_season.py's --reset-live step flips this to false for everyone
-- as the actual "clear the board" action (it never deletes players rows —
-- torvik_metrics.py matches by (name, team) and needs the row to already
-- exist, so deleting would break that continuity, lose espn_id/archetype
-- work, etc). Every write path that creates or updates a players row for
-- the new season (scraper_to_supabase.py, import_portal.py,
-- torvik_metrics.py / torvik_metrics_w.py, import_w_torvik.py) sets it
-- back to true — so a player reappears on the board exactly when the new
-- season's pipeline actually confirms they're on a roster or in the
-- portal, not before. Anyone the new pipeline never touches (graduated,
-- drafted, left) just stays false — a real clean slate, no deletes, fully
-- reversible.
-- ============================================================

alter table public.players   add column if not exists on_board boolean not null default true;
alter table public.w_players add column if not exists on_board boolean not null default true;

create index if not exists players_on_board_idx   on public.players   (on_board);
create index if not exists w_players_on_board_idx on public.w_players (on_board);

notify pgrst, 'reload schema';
