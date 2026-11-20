-- ============================================================
-- Beyond the Portal — Clear all MEN'S archetypes (clean slate)
-- Run this entire file in: Supabase dashboard → SQL Editor.
--
-- Purpose: wipe every men's archetype so a brand-new set can be defined
-- from scratch in Admin → Archetypes. Removes DATA only — the
-- infrastructure is untouched:
--   - the archetype_defs table itself (and its RLS policies, color column)
--   - the archetype / archetypes / archetype_overwrite / archetype_override
--     columns on public.players
--   - the Admin → Archetypes tab, the board pill/filter, the player edit form
-- After this runs, the board shows no archetype pills and the archetype
-- filter dropdown is empty until new definitions are created. Once they
-- are, Admin → Archetypes → "Recompute" assigns them to players again.
--
-- Scope (deliberately narrow):
--   - Men's domestic ONLY. Does NOT touch w_archetype_defs / w_players
--     (women's) or international_archetype_defs / international_players /
--     w_international_players.
--   - Does NOT touch season_board_archive — archived seasons keep the
--     archetypes they had at the time, as a historical record.
--
-- NOT reversible from this script. If you might want the old definitions
-- back for reference, export them first:
--   Table Editor → archetype_defs → Export → CSV.
--
-- Safe to run more than once (second run is a no-op).
-- ============================================================

begin;

-- 1. Every men's archetype definition (name, thresholds, priority, color).
delete from public.archetype_defs;

-- 2. Every men's player's assigned archetypes and manual overrides.
--    archetype_override = null means "auto" (use threshold matches), so
--    once new definitions exist and Recompute runs, every player gets
--    matched against the new set — no stale per-player pins left over.
update public.players
set archetype           = null,
    archetypes          = '[]'::jsonb,
    archetype_overwrite = null,
    archetype_override  = null
where archetype is not null
   or (archetypes is not null and archetypes <> '[]'::jsonb)
   or archetype_overwrite is not null
   or archetype_override is not null;

commit;

-- ── Verify (all three should be 0) ───────────────────────────────────────────
select
  (select count(*) from public.archetype_defs)                                     as defs_remaining,
  (select count(*) from public.players where archetype is not null)                as players_with_archetype,
  (select count(*) from public.players
     where archetype_overwrite is not null or archetype_override is not null)      as players_with_override;
