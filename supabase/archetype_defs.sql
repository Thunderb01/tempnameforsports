-- ============================================================
-- Beyond the Portal — Fillable Archetypes (superadmin)
-- Run this entire file in: Supabase dashboard → SQL Editor.
--
-- Adds admin-editable archetype DEFINITIONS (named threshold ranges)
-- for three player pools — men's domestic, women's domestic, and
-- international — plus a per-player `archetype_overwrite` exception
-- column. The resolved value still lands in the existing `archetype`
-- column (overwrite ?? threshold-match ?? null), so no consumer changes.
--
-- Each defs row carries a nullable min/max per matchable field. A null
-- bound means "unbounded" on that end. A player matches an archetype
-- when EVERY non-null range contains the player's corresponding value;
-- the lowest `priority` wins when several match.
-- ============================================================

-- ── Helper: superadmin check (inline in policies, mirrors tier_labels) ───────
-- (No function needed — we reuse the same EXISTS(...) predicate used by
--  international_tier_labels in schema.sql.)

-- ─────────────────────────────────────────────────────────────────────────────
-- Men's domestic archetype definitions
-- Matchable fields: ppg, rpg, apg, p3_pct (box stats) + sei, ath, ris, dds, cdi
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.archetype_defs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  priority    integer not null default 0,
  ppg_min     numeric, ppg_max     numeric,
  rpg_min     numeric, rpg_max     numeric,
  apg_min     numeric, apg_max     numeric,
  p3_pct_min  numeric, p3_pct_max  numeric,
  sei_min     numeric, sei_max     numeric,
  ath_min     numeric, ath_max     numeric,
  ris_min     numeric, ris_max     numeric,
  dds_min     numeric, dds_max     numeric,
  cdi_min     numeric, cdi_max     numeric,
  created_at  timestamp with time zone default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Women's domestic archetype definitions (same shape; separate per fork model)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.w_archetype_defs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  priority    integer not null default 0,
  ppg_min     numeric, ppg_max     numeric,
  rpg_min     numeric, rpg_max     numeric,
  apg_min     numeric, apg_max     numeric,
  p3_pct_min  numeric, p3_pct_max  numeric,
  sei_min     numeric, sei_max     numeric,
  ath_min     numeric, ath_max     numeric,
  ris_min     numeric, ris_max     numeric,
  dds_min     numeric, dds_max     numeric,
  cdi_min     numeric, cdi_max     numeric,
  created_at  timestamp with time zone default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- International archetype definitions
-- Matchable fields: pts, reb, ast, p3_pct (box stats) + the international five
-- (offensive_footprint, defensive_score, winning_impact, sos_performance,
--  translation_grade). Applied to BOTH international_players AND
-- w_international_players — they share an identical metric schema, so a single
-- defs table covers the international pool for both sports.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.international_archetype_defs (
  id                       uuid primary key default gen_random_uuid(),
  name                     text not null,
  priority                 integer not null default 0,
  pts_min                  numeric, pts_max                  numeric,
  reb_min                  numeric, reb_max                  numeric,
  ast_min                  numeric, ast_max                  numeric,
  p3_pct_min               numeric, p3_pct_max               numeric,
  offensive_footprint_min  numeric, offensive_footprint_max  numeric,
  defensive_score_min      numeric, defensive_score_max      numeric,
  winning_impact_min       numeric, winning_impact_max       numeric,
  sos_performance_min      numeric, sos_performance_max      numeric,
  translation_grade_min    numeric, translation_grade_max    numeric,
  created_at               timestamp with time zone default now()
);

-- ── RLS: authenticated read, superadmin all (mirrors international_tier_labels) ─
do $$
declare t text;
begin
  foreach t in array array['archetype_defs','w_archetype_defs','international_archetype_defs']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format($f$
      drop policy if exists "Authenticated can read %1$s" on public.%1$I;
      create policy "Authenticated can read %1$s"
        on public.%1$I for select
        to authenticated
        using (true);
    $f$, t);

    execute format($f$
      drop policy if exists "Superadmin manages %1$s" on public.%1$I;
      create policy "Superadmin manages %1$s"
        on public.%1$I for all
        using      (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'))
        with check (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'));
    $f$, t);
  end loop;
end $$;

-- ── New columns ──────────────────────────────────────────────────────────────
-- Domestic: archetype already exists; add the per-player exception override.
alter table public.players   add column if not exists archetype_overwrite text;
alter table public.w_players add column if not exists archetype_overwrite text;

-- International: no archetype concept existed yet — add both.
alter table public.international_players   add column if not exists archetype           text;
alter table public.international_players   add column if not exists archetype_overwrite text;
alter table public.w_international_players add column if not exists archetype           text;
alter table public.w_international_players add column if not exists archetype_overwrite text;

-- ── Surface archetype_overwrite through the women's view ─────────────────────
-- (the recompute reads the overwrite + 9 fields from the view in one query).
-- vw_players (men's) must be recreated in Studio the same way — see note below.
create or replace view public.vw_w_players as
select
  p.id,
  p.name,
  p.current_team,
  p.primary_position,
  p.year,
  p.height,
  p.hometown,
  p.source,
  p.espn_id,
  p.eligibility_years,
  p.archetype,
  p.nil_valuation,
  p.open_market_low,
  p.open_market_high,
  s.year      as calendar_year,
  s.ppg, s.rpg, s.apg, s.usg, s.ast_tov,
  s.fg_pct, s."3p_pct", s.ft_pct,
  s.sei, s.ath, s.ris, s.dds, s.cdi,
  s.school,
  s.conference,
  -- New column MUST be appended last: CREATE OR REPLACE VIEW only allows
  -- adding columns at the end, never inserting mid-list (that reads as a
  -- rename and errors with 42P16).
  p.archetype_overwrite
from public.w_players p
left join lateral (
  select *
  from public.w_player_stats ps
  where ps.player_id = p.id
  order by ps.year desc nulls last
  limit 1
) s on true;

-- ── PostgREST schema reload so the new tables/columns show up over REST ──────
notify pgrst, 'reload schema';

-- ============================================================
-- MANUAL STEP — recreate vw_players (men's) to expose archetype_overwrite.
-- The men's view lives only in the DB (not in this repo). In Supabase Studio →
-- Database → Views → vw_players → copy its definition, add
--   , p.archetype_overwrite
-- as the LAST item in the SELECT list (right before FROM), then run the
-- CREATE OR REPLACE VIEW.
--
-- IMPORTANT: append it at the END. CREATE OR REPLACE VIEW only allows adding
-- columns last — inserting one mid-list shifts the others and Postgres rejects
-- it as a column rename (ERROR 42P16). If you'd rather not hand-edit, run
-- `DROP VIEW public.vw_players;` first, then recreate it with the new column
-- anywhere (nothing but the app reads this view).
-- ============================================================
