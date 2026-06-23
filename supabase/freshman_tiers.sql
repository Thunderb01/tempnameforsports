-- ============================================================
-- Freshman Impact Tiering
-- Run in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Admin-defined impact tiers for incoming freshmen. Each tier carries an
-- `effect` = the BTP-score a freshman of that tier contributes to roster
-- strength. On a roster build, a freshman tagged with a tier becomes a
-- scoreable pseudo-player at their position and flows through the same
-- starter/bench/depth slot-weighting as everyone else.
--
-- `effect` is in BTP-score units (rosterScore / 1,000,000 = "M BTP"; a strong
-- starter ≈ ~1M). Defaults below are a starting point — tune in /admin.
-- ============================================================

create table if not exists public.freshman_tiers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  effect     numeric not null default 0,
  color      text default '#fbbf24',
  sort       integer not null default 0,
  created_at timestamp with time zone default now()
);

create table if not exists public.w_freshman_tiers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  effect     numeric not null default 0,
  color      text default '#fbbf24',
  sort       integer not null default 0,
  created_at timestamp with time zone default now()
);

-- ── RLS: authenticated read, superadmin manage (mirrors international_tier_labels) ─
do $$
declare t text;
begin
  foreach t in array array['freshman_tiers','w_freshman_tiers']
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

-- ── Tag column on the custom-player tables (stores the tier NAME; null = none) ─
alter table public.custom_roster_players   add column if not exists freshman_tier text;
alter table public.w_custom_roster_players add column if not exists freshman_tier text;

-- ── Seed default tiers (rename / retune in the admin) ────────────────────────
insert into public.freshman_tiers (name, effect, color, sort) values
  ('High Impact',   900000, '#4ade80', 0),
  ('Medium Impact', 450000, '#5b9cf6', 1),
  ('Low Impact',    200000, '#9ca3af', 2)
on conflict (name) do nothing;

insert into public.w_freshman_tiers (name, effect, color, sort) values
  ('High Impact',   900000, '#4ade80', 0),
  ('Medium Impact', 450000, '#5b9cf6', 1),
  ('Low Impact',    200000, '#9ca3af', 2)
on conflict (name) do nothing;

notify pgrst, 'reload schema';
