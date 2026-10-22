-- ============================================================
-- Season board archive — a full "Full Board" snapshot per past season
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- historical_stats (historical.sql) is a deliberately bare, stats-only
-- archive with no portal/archetype/tag data, by design decoupled from the
-- live app. This table is the opposite: a flattened copy of everything a
-- board row shows (stats, archetypes, tags, transfer status/destination,
-- NIL values, admin player_status) at the moment a season is archived via
-- archive_season.py. No foreign key into players/w_players — a snapshot
-- row must survive even if the source player row is later edited, merged,
-- or deleted, same reasoning as historical_stats.
--
-- One row per player per archived season. Dedup/upsert target is
-- (season_year, player_id) — player_id is the source players/w_players.id
-- at archive time, kept only as a loose reference (no FK), not a join key
-- for anything live.
-- ============================================================

create table if not exists public.season_board_archive (
  id                uuid primary key default gen_random_uuid(),
  season_year        integer not null,
  player_id          uuid,                 -- players.id at archive time (no FK — see above)
  torvik_pid         integer,
  name               text not null,
  team               text,
  conference         text,
  primary_position   text,
  positions          text[],
  year               text,                 -- class year label (Fr/So/Jr/Sr/…)
  height             text,
  hometown            text,
  espn_id            text,

  -- Box stats + BTP metrics (most recent season row at archive time)
  ppg                numeric,
  rpg                numeric,
  apg                numeric,
  usg                numeric,
  ast_tov            numeric,
  fg_pct             numeric,
  "3p_pct"           numeric,
  ft_pct             numeric,
  sei                numeric,
  ath                numeric,
  ris                numeric,
  dds                numeric,
  cdi                numeric,

  -- NIL / valuation
  nil_valuation      numeric,
  open_market_low    numeric,
  open_market_high   numeric,
  projected_tier     text,

  -- Archetype + tags (men's only live today — columns stay null for women's
  -- until that product surface exists, same gating BoardPage.jsx uses)
  archetype          text,
  archetypes         text[],
  playmaker_tags     text,
  shooting_tags      text,
  shotmaking_tags    text,
  defensive_tags     text,
  interior_tags      text,

  -- Admin status + portal transfer snapshot
  player_status        text,
  transfer_status       text,
  transfer_from_team    text,
  transfer_to_team      text,
  transfer_season_year  integer,

  archived_at        timestamp with time zone default now(),
  unique (season_year, player_id)
);

create table if not exists public.w_season_board_archive (LIKE public.season_board_archive INCLUDING ALL);

create index if not exists season_board_archive_season_team_idx   on public.season_board_archive   (season_year, team);
create index if not exists season_board_archive_season_name_idx   on public.season_board_archive   (season_year, name);
create index if not exists w_season_board_archive_season_team_idx on public.w_season_board_archive (season_year, team);
create index if not exists w_season_board_archive_season_name_idx on public.w_season_board_archive (season_year, name);

alter table public.season_board_archive   enable row level security;
alter table public.w_season_board_archive enable row level security;

-- Anyone signed in can read the archive — same policy shape as historical_stats.
drop policy if exists "Authenticated read season archive" on public.season_board_archive;
create policy "Authenticated read season archive"
  on public.season_board_archive for select
  to authenticated
  using (true);

drop policy if exists "Authenticated read w season archive" on public.w_season_board_archive;
create policy "Authenticated read w season archive"
  on public.w_season_board_archive for select
  to authenticated
  using (true);

-- Superadmin writes (archive_season.py uses the service role, which bypasses
-- RLS; this policy covers any authenticated superadmin edits made by hand).
drop policy if exists "Superadmin writes season archive" on public.season_board_archive;
create policy "Superadmin writes season archive"
  on public.season_board_archive for all
  using      (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'))
  with check (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'));

drop policy if exists "Superadmin writes w season archive" on public.w_season_board_archive;
create policy "Superadmin writes w season archive"
  on public.w_season_board_archive for all
  using      (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'))
  with check (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'));

notify pgrst, 'reload schema';
