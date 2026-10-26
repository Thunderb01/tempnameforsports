-- ============================================================
-- App-wide feature toggles a superadmin controls from /admin,
-- rather than per-user/per-team local state. Key-value so a new
-- toggle is just a new row, not a new column/migration.
--
-- First key: transfer_season_active -- gates whether the Roster
-- Builder's retention-status label ("Returning") is shown. Outside
-- the actual transfer window every on_board player defaults to
-- "returning" anyway, so the label is pure noise; a superadmin
-- flips this on once the portal actually opens.
--
-- Safe to re-run (idempotent).
-- ============================================================

create table if not exists public.app_settings (
  key        text primary key,
  value      boolean not null default false,
  updated_at timestamp with time zone default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "Authenticated can read app_settings" on public.app_settings;
create policy "Authenticated can read app_settings"
  on public.app_settings for select
  to authenticated
  using (true);

-- Mirrors freshman_tiers.sql's "superadmin manages" pattern.
drop policy if exists "Superadmin manages app_settings" on public.app_settings;
create policy "Superadmin manages app_settings"
  on public.app_settings for all
  using      (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'))
  with check (exists (select 1 from public.coaches where coaches.user_id = auth.uid() and coaches.role = 'superadmin'));

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_settings_updated_at on public.app_settings;
create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

insert into public.app_settings (key, value) values ('transfer_season_active', false)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
