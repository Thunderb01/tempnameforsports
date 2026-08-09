-- ============================================================
-- Consolidate the transfer-portal system onto players/w_players.
--
-- Previously "who's in the transfer portal" lived in a separate
-- `portal_transfers` table, disconnected from `players.player_status`
-- (the field admins actually edit). This adds the portal-specific detail
-- (destination team, external sync id, lifecycle) directly onto the
-- player row so player_status can become the single source of truth for
-- where a player shows up across the app.
--
-- portal_transfers / w_portal_transfers are left in place, unused, as a
-- rollback safety net — not dropped in this pass.
--
-- Safe to run more than once.
-- ============================================================

alter table public.players
  add column if not exists transfer_status      text,   -- uncommitted | committed | withdrawn
  add column if not exists transfer_from_team    text,
  add column if not exists transfer_to_team      text,
  add column if not exists transfer_season_year  integer,
  add column if not exists transfer_api_id       integer;

create unique index if not exists players_transfer_api_id_idx
  on public.players (transfer_api_id) where transfer_api_id is not null;

alter table public.w_players
  add column if not exists transfer_status      text,
  add column if not exists transfer_from_team    text,
  add column if not exists transfer_to_team      text,
  add column if not exists transfer_season_year  integer,
  add column if not exists transfer_api_id       integer;

create unique index if not exists w_players_transfer_api_id_idx
  on public.w_players (transfer_api_id) where transfer_api_id is not null;

notify pgrst, 'reload schema';
