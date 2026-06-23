-- ============================================================
-- Superadmin Team Freshmen — official incoming recruits per team
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- A superadmin attaches official incoming freshmen to a team. These are global:
-- they show (read-only) on every coach's build of that team and raise that
-- team's score in the national/conference comparison. `tier` is a
-- freshman_tiers.name (join by name, like custom_roster_players.freshman_tier).
-- ============================================================

-- Optional BTP metrics (0–100): when set by a superadmin, they DRIVE the
-- freshman's roster-strength score (computed like a real player) and the tier
-- is used only as the fallback for freshmen left without metrics.
create table if not exists public.team_freshmen (
  id               uuid primary key default gen_random_uuid(),
  team             text not null,
  name             text not null,
  pos              text,            -- Guard | Wing | Big
  tier             text,            -- freshman_tiers.name (fallback score)
  recruiting_class text,
  sei numeric, ath numeric, ris numeric, dds numeric, cdi numeric,
  nil_valuation numeric,            -- projected NIL/market $ (feeds metric-driven score)
  created_at       timestamp with time zone default now()
);

create table if not exists public.w_team_freshmen (
  id               uuid primary key default gen_random_uuid(),
  team             text not null,
  name             text not null,
  pos              text,
  tier             text,
  recruiting_class text,
  sei numeric, ath numeric, ris numeric, dds numeric, cdi numeric,
  nil_valuation numeric,
  created_at       timestamp with time zone default now()
);

-- Backfill metric + NIL columns onto tables created before this revision.
do $$
declare t text; m text;
begin
  foreach t in array array['team_freshmen','w_team_freshmen'] loop
    foreach m in array array['sei','ath','ris','dds','cdi','nil_valuation'] loop
      execute format('alter table public.%I add column if not exists %I numeric', t, m);
    end loop;
  end loop;
end $$;

create index if not exists team_freshmen_team_idx   on public.team_freshmen   (team);
create index if not exists w_team_freshmen_team_idx on public.w_team_freshmen (team);

-- ── RLS: authenticated read, superadmin manage (mirrors freshman_tiers) ──────
do $$
declare t text;
begin
  foreach t in array array['team_freshmen','w_team_freshmen']
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

notify pgrst, 'reload schema';
