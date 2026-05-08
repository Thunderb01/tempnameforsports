-- ============================================================
-- Beyond the Portal — Supabase Schema
-- Run this entire file in: Supabase dashboard → SQL Editor
-- ============================================================

-- ── Coaches (links Supabase auth users to a team) ─────────────
create table if not exists public.coaches (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamp with time zone default now(),
  user_id      uuid references auth.users(id) on delete cascade not null unique,
  team         text not null,
  display_name text,
  role         text default 'coach' check (role in ('coach','admin'))
);

alter table public.coaches enable row level security;

create policy "Coaches read own row"
  on public.coaches for select
  using (auth.uid() = user_id);

-- ── Rosters (returning players, one row per player per team) ──
create table if not exists public.rosters (
  id               uuid primary key default gen_random_uuid(),
  team             text not null,
  name             text not null,
  primary_position text,
  year             text,
  ppg              numeric,
  reb_g            numeric,
  ast_g            numeric,
  usg_pct          numeric,
  fg_pct           text,
  three_p_pct      text,
  ft_pct           text,
  three_pa_g       numeric,
  ast_tov          numeric,
  stl_40           numeric,
  blk_40           numeric,
  playmaker_tags   text,
  shooting_tags    text,
  updated_at       timestamp with time zone default now(),
  unique (team, name)
);

alter table public.rosters enable row level security;

-- Coaches can only read their own team's roster
create policy "Coaches read own team roster"
  on public.rosters for select
  using (
    team = (
      select team from public.coaches
      where user_id = auth.uid()
      limit 1
    )
  );

-- ── Portal board (your import board — all portal targets) ──────
create table if not exists public.portal_board (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  team             text,
  primary_position text,
  year             text,
  usg_pct          numeric,
  ppg              numeric,
  reb_g            numeric,
  ast_g            numeric,
  three_pa_g       numeric,
  ast_tov          numeric,
  stl_40           numeric,
  blk_40           numeric,
  drb_40           numeric,
  orb_40           numeric,
  trb_40           numeric,
  fg_pct           text,
  atr_pct          text,
  ft_pct           text,
  three_p_pct      text,
  market_low       numeric,
  market_high      numeric,
  cdi              numeric,
  dds              numeric,
  sei              numeric,
  smi              numeric,
  ris              numeric,
  playmaker_tags   text,
  shooting_tags    text,
  created_at       timestamp with time zone default now(),
  updated_at       timestamp with time zone default now()
);

alter table public.portal_board enable row level security;

-- Any authenticated coach can read the full portal board
create policy "Authenticated coaches read portal board"
  on public.portal_board for select
  using (auth.role() = 'authenticated');

-- ── Helper: auto-update updated_at on portal_board ────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger portal_board_updated_at
  before update on public.portal_board
  for each row execute function public.set_updated_at();

-- ============================================================
-- Done. Next steps:
-- 1. Set Auth → Providers → Email → enabled (turn off confirm
--    email for now if testing locally)
-- 2. Set Auth → URL Configuration → Site URL to your Vercel URL
-- 3. Run create_coach.py to add your first coach account
-- 4. Run scraper_to_supabase.py to populate rosters
-- 5. Import your portal board CSV via the Supabase Table Editor
--    (Table Editor → portal_board → Insert → Import CSV)
-- ============================================================

-- ── Access requests (from the "Request access" form on login page) ────
create table if not exists public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamp with time zone default now(),
  name       text not null,
  school     text not null,
  position   text not null,
  email      text not null
);

alter table public.access_requests enable row level security;

-- Anyone (even unauthenticated) can submit — only you can read them in the dashboard
create policy "Anyone can submit an access request"
  on public.access_requests for insert
  with check (true);


-- ── International players ──────────────────────────────────────────────────────
-- One row per player per league. Profile URL links back to RealGM.
create table if not exists public.international_players (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  league            text not null,
  profile_url       text,
  height            text,
  primary_position  text,
  agent_name        text,
  agent_contact     text,
  film_url          text,
  competition_tier  integer default 2 check (competition_tier between 1 and 4),
  metrics           jsonb default '{}',
  created_at        timestamp with time zone default now(),
  unique (name, league)
);

alter table public.international_players enable row level security;

create policy "Authenticated users can read international players"
  on public.international_players for select
  to authenticated
  using (true);

create policy "Service role can upsert international players"
  on public.international_players for insert
  with check (true);


-- ── International player stats ─────────────────────────────────────────────────
-- One row per player / season / stat_type / team.
-- stats JSONB holds all scraped columns (varies by stat_type: Averages, Advanced_Stats, etc.)
create table if not exists public.international_players_stats (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid references public.international_players(id) on delete cascade,
  player_name text not null,
  league      text not null,
  season      integer not null,
  season_type text not null default 'Regular_Season',
  stat_type   text not null default 'Averages',
  team        text,
  stats       jsonb not null default '{}',
  scraped_at  timestamp with time zone default now(),
  unique (player_name, league, season, season_type, stat_type, team)
);

alter table public.international_players_stats enable row level security;

create policy "Authenticated users can read international stats"
  on public.international_players_stats for select
  to authenticated
  using (true);

create policy "Service role can upsert international stats"
  on public.international_players_stats for insert
  with check (true);
