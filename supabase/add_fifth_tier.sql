-- ============================================================
-- Add a 5th international competition tier.
-- Relaxes the `between 1 and 4` CHECK constraints to `between 1 and 5`
-- on the international tables (men's + women's). The women's tables were
-- created via `LIKE … INCLUDING ALL`, so their CHECK constraints have
-- auto-generated names — this finds and drops them dynamically, then re-adds
-- the widened range. Safe to run more than once.
--
-- Tier 5 has no required label row; the UI falls back to "Academy / Youth"
-- until a superadmin sets one in /admin/international → Tier Labels.
-- ============================================================

do $$
declare
  r record;
  t text;
  reg regclass;
  player_tbls text[] := array['international_players', 'w_international_players'];
  label_tbls  text[] := array['international_tier_labels', 'w_international_tier_labels'];
begin
  -- 1. Drop the existing tier-range CHECK on each table. Postgres stores the
  --    range as `((tier >= 1) AND (tier <= 4))`, not the literal "between", so
  --    we match any CHECK that references a tier column (and re-add it below).
  for r in
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where contype = 'c'
      and pg_get_constraintdef(oid) ~* 'tier'
      and conrelid in (
        select oid from pg_class
        where relname = any (player_tbls || label_tbls)
          and relnamespace = 'public'::regnamespace
      )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  -- 2. Re-add the widened range (only for tables that actually exist).
  foreach t in array player_tbls loop
    reg := to_regclass('public.' || t);
    if reg is not null then
      execute format('alter table public.%I add constraint %I check (competition_tier between 1 and 5)',
                     t, t || '_competition_tier_check');
    end if;
  end loop;

  foreach t in array label_tbls loop
    reg := to_regclass('public.' || t);
    if reg is not null then
      execute format('alter table public.%I add constraint %I check (tier between 1 and 5)',
                     t, t || '_tier_check');
      -- Seed a default label for the new tier (rename later in the admin).
      execute format($q$insert into public.%I (tier, label) values (5, 'Academy / Youth')
                       on conflict (tier) do nothing$q$, t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
