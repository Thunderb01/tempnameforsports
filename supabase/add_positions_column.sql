-- ============================================================
-- Multi-position support: PG/SG/SF/PF/C replacing Guard/Wing/Big.
--
-- `positions` is an ELIGIBILITY SET — the positions a player can credibly
-- play — not a list of roles held simultaneously. Scoring assigns each
-- player to exactly one of them (see src/lib/positions.js).
--
-- `primary_position` stays, but its vocabulary changes from Guard|Wing|Big
-- to PG|SG|SF|PF|C (element 0 of `positions`), so every existing display
-- path keeps working and simply renders the new value.
--
-- Derived from Bart Torvik's `role` column, four values of which are
-- inherently dual (Combo G, Wing G, Wing F, PF/C).
--
-- NOTE: w_players was created via `LIKE public.players INCLUDING ALL`
-- (womens_tables.sql:13), which does NOT propagate columns added later —
-- hence the explicit second ALTER rather than relying on inheritance.
--
-- The percentile peer grouping used for sei/ath/ris/dds/cdi and NIL
-- valuations is deliberately NOT touched: it lives in-memory in
-- torvik_metrics.py as `pos_bucket` and is never stored, so this migration
-- changes no metric and no dollar figure.
--
-- Safe to run more than once.
-- ============================================================

alter table public.players   add column if not exists positions text[];
alter table public.w_players add column if not exists positions text[];

-- Baseline backfill: expand the legacy bucket so nothing disappears from
-- position filters before the Torvik re-run refines these into real
-- five-position sets. src/lib/positions.js applies the same expansion at
-- read time, so rows Torvik never matches still behave sensibly.
update public.players
set positions = case primary_position
  when 'Guard' then array['PG','SG']
  when 'Wing'  then array['SF']
  when 'Big'   then array['PF','C']
end
where positions is null
  and primary_position in ('Guard', 'Wing', 'Big');

update public.w_players
set positions = case primary_position
  when 'Guard' then array['PG','SG']
  when 'Wing'  then array['SF']
  when 'Big'   then array['PF','C']
end
where positions is null
  and primary_position in ('Guard', 'Wing', 'Big');

-- w_players.primary_position additionally holds raw Torvik role labels for
-- rows seeded by import_w_torvik.py (which wrote `role` verbatim). Map those
-- directly rather than leaving them null.
update public.w_players
set positions = case primary_position
  when 'Pure PG'    then array['PG']
  when 'Scoring PG' then array['PG']
  when 'Combo G'    then array['PG','SG']
  when 'Wing G'     then array['SG','SF']
  when 'Wing F'     then array['SF','PF']
  when 'Stretch 4'  then array['PF']
  when 'PF/C'       then array['PF','C']
  when 'C'          then array['C']
end
where positions is null
  and primary_position in ('Pure PG','Scoring PG','Combo G','Wing G','Wing F','Stretch 4','PF/C','C');

notify pgrst, 'reload schema';
