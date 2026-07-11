-- ============================================================
-- Historical "Time Machine" — BTP metrics for past players (2009–present)
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Fully isolated from the live app: a flat, one-row-per-player-season table with
-- NO foreign key into players/player_stats, so historical data never appears in
-- the portal board, rankings, or roster builder. The Historical page queries
-- this table directly by season. Dedup across seasons is via Barttorvik's stable
-- `torvik_pid` (unique with year).
-- ============================================================

create table if not exists public.historical_stats (
  id            uuid primary key default gen_random_uuid(),
  torvik_pid    integer,
  year          integer not null,
  name          text not null,
  team          text,
  conf          text,
  pos           text,          -- Guard | Wing | Big (bucketed)
  class_yr      text,          -- Fr | So | Jr | Sr | Gr
  height        text,
  hometown      text,

  -- Box stats (per game, from the Torvik CSV)
  ppg           numeric,
  rpg           numeric,
  apg           numeric,
  "3p_pct"      numeric,

  -- Beyond the Portal metrics (0–100, within-season position percentiles)
  sei           numeric,
  ath           numeric,
  ris           numeric,
  dds           numeric,
  cdi           numeric,

  -- Projected value (labeled estimate; may be null in v1 until NIL is wired)
  nil_valuation numeric,
  projected_tier text,

  -- Raw Torvik advanced columns surfaced in the modal's Advanced view
  torvik_usg     numeric,
  torvik_ts      numeric,
  torvik_efg     numeric,
  torvik_ortg    numeric,
  torvik_bpm     numeric,
  torvik_ast_pct numeric,
  torvik_to_pct  numeric,
  torvik_blk_pct numeric,
  torvik_stl_pct numeric,
  torvik_orb_pct numeric,
  torvik_drb_pct numeric,
  torvik_min_pct numeric,
  torvik_gp      integer,

  created_at    timestamp with time zone default now(),
  unique (torvik_pid, year)
);

create index if not exists historical_stats_year_team_idx on public.historical_stats (year, team);
create index if not exists historical_stats_year_name_idx on public.historical_stats (year, name);

alter table public.historical_stats enable row level security;

-- Anyone signed in can read the archive.
drop policy if exists "Authenticated read historical" on public.historical_stats;
create policy "Authenticated read historical"
  on public.historical_stats for select
  to authenticated
  using (true);

-- Superadmin writes (the importer uses the service role, which bypasses RLS;
-- this policy covers any authenticated superadmin edits).
drop policy if exists "Superadmin writes historical" on public.historical_stats;
create policy "Superadmin writes historical"
  on public.historical_stats for all
  using      (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'))
  with check (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'));

notify pgrst, 'reload schema';
