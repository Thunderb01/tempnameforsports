# Beyond the Portal — Codebase Notes

Short, high-leverage rules for working in this repo. Read me before adding
features. Updated as new conventions land.

---

## Alias / lookup-table rules

Wherever a feature looks up a value by a name that users or DB columns spell
in inconsistent ways, **go through the canonical helper** — never index the
raw lookup table directly. The repo has a CI check (`npm run check:lookups`)
that fails the build if a callsite skips the helper.

| Domain | Helper | Backing data |
|---|---|---|
| Team → conference        | `getTeamConference(team)` from `@/lib/teamLookup`     | `data/team_conferences.csv` (single source of truth, imported via Vite `?raw`) |
| Team name canonicalization | `getCanonicalTeamName(team)` from `@/lib/teamLookup` | Same CSV + `EXPLICIT_ALIASES` map in `teamLookup.js`                       |
| Player name matching (Python pipeline) | `norm_name(name)` / `match_player(...)` from `match_utils` | `FIRST_NAME_ALIASES` dict + fuzzy fallback (rapidfuzz, else `difflib`) in `match_utils.py` |

Why this matters: `vw_players.current_team` carries strings like
`"Murray State"` while the JSON keys it as `"Murray St."`, and stale player
metadata can leak `"UC Santa Barbara (2 Yrs)"` into supposedly clean fields.
The helper normalizes (trailing parens, `Saint`/`St.`, `State`/`St.`, periods,
case) and resolves an `EXPLICIT_ALIASES` map for cases regex can't handle
(Loyola Chicago vs Loyola (IL), Miami FL vs Miami OH, UNC vs North Carolina,
UConn vs Connecticut, BYU, etc.).

Same story on the player-name side: `players`/`w_players` get fed from Bart
Torvik, ESPN, Sports-Reference scrapes, and manual portal entry, and those
sources spell the same person differently — nicknames (`"Cam Smith"` vs
`"Cameron Smith"`), apostrophes (`"O'Brien"`), suffixes. Every script that
matches or dedupes players by name must go through `match_utils.norm_name()` /
`match_utils.match_player()` rather than comparing raw strings — it handles
suffix-stripping, apostrophe-merging, and a conservative nickname table
(`FIRST_NAME_ALIASES`) before falling back to fuzzy matching. Known exception:
`scraper_to_supabase.py`'s nightly upsert still keys off a DB-level
`UNIQUE (name, current_team, source)` constraint with no normalization —
flagged, not yet fixed, since changing it means either a schema migration or
rewriting the upsert as select-then-insert-or-update.

**When you add a new feature that touches a name-keyed lookup:**

1. If a normalizer for that field already exists, use it.
2. If not, add one in `src/lib/` (`xxxLookup.js`) with the same shape:
   - One `normalize<Thing>Name(s)` function.
   - One `getXxx(name)` lookup that tries exact match → normalized → alias.
   - A pre-built index built once at module load.
3. Add a rule to `scripts/check-lookups.mjs` so the build catches anyone
   bypassing the helper later.
4. Update this table.

---

## State that's local vs. shared

- `useRosterBoard` is the single source of truth for the user's roster build
  (roster, retention, NIL offers, intl cache, settings). State persists per
  `(user, team)` in localStorage; switching teams reloads that team's blob
  cleanly. Don't add component-local copies of roster state.
- The portal board (`board.state.board`) is a session-cached snapshot of
  `vw_players` + `portal_transfers` commit reassignment. Bump
  `SESSION_BOARD_VER` whenever the per-player shape changes.

---

## Positions (PG/SG/SF/PF/C, multi-position)

`src/lib/positions.js` is the single source of truth. Players carry a
`positions text[]` **eligibility set** — the spots they can credibly play —
derived from Bart Torvik's `role` column, four values of which are inherently
dual (`Combo G`, `Wing G`, `Wing F`, `PF/C`). `primary_position` mirrors
element 0 so single-value display paths keep working.

**A player is eligible at several positions but occupies exactly one.**
`assignToPositions()` enforces this. Never fan a player into multiple buckets:
every scoring path sums all buckets, so a dual-position player counted twice
inflates versatile rosters against specialist ones and silently reorders every
ranking.

Slot weights within a position: `1.00` starters, `0.20` the next 3 off the
bench, `0.04` deeper depth. International players are excluded from scoring.

Use `positionsFor(player)` to read positions (it handles the array, a single
value, and legacy Guard/Wing/Big rows) and `positionLabel(player)` to display
them ("PG/SG"). Reuse `scoreRoster` / `computeOptimalLineup` / `slotWeight`
rather than re-implementing — four divergent copies of the lineup algorithm
previously existed and had to be hand-synced.

`scripts/test-positions.mjs` covers this module and runs as part of
`npm run build`.

### Metric peer groups: 4-bucket (Guard/Wing/Forward/Big), per the BTP Metrics Spec

`torvik_metrics.py`/`torvik_metrics_w.py`'s `normalise_pos` / `percentrank_by_pos`
group by Guard/Wing/Forward/Big, and every BTP metric (sei/ath/ris/dds/cdi)
**and every NIL valuation** is a percentile computed *within* that group.
**Do not change `normalise_pos` or `percentrank_by_pos` without intending to
revalue the entire database** — every number in the app shifts.

This used to be 3-bucket (Guard/Wing/Big), with `Stretch 4` falling through
to Wing (so those players displayed as PF but were ranked against wings).
The BTP Metrics Spec formalized that as its own 4th bucket — "Forward" is
Barttorvik's `Wing F` and `Stretch 4` roles, checked in `normalise_pos`
*before* the generic Wing branch (since `"wing f"` contains `"wing"` and
would otherwise match it first).

Adding a 4th bucket touches every `pos_bucket`-keyed structure in both
files, not just `normalise_pos` — audit for these before changing the
bucket set again:
- `_BUCKET_TO_POSITIONS` (five-position fallback for role-less players)
- `compute_cdi`'s `pos_mult` — a plain `.map()` with **no fallback**; an
  unmapped bucket silently produces NaN (blank CDI) for every player in it.
  This is the one that actually breaks, not just drifts, if you add a
  bucket and forget it.
- `compute_ath`'s four weight dicts (`EXPLOSION_W`/`MOBILITY_W`/`CONTACT_W`/
  `COMPONENT_W`) — these use `.get(bucket, X["Wing"])`, so a forgotten
  bucket degrades to Wing's weights rather than breaking. Forward's entries
  today are the Wing/Big midpoint, a placeholder (ATH isn't covered by the
  spec's Forward split yet).
- NIL valuation's `pos_boost` — `.map()` with `.fillna(1.0)`, so a
  forgotten bucket silently gets a neutral boost rather than breaking.

The five-position model (`torvik_role_to_positions` / `src/lib/positions.js`)
is unrelated to this and wasn't touched — `Wing F` still maps to `["SF", "PF"]`
and `Stretch 4` to `["PF"]` for display/lineup purposes, same as always.

**Minutes cutoff is now 20%** (`Min_per >= 20`, was 10%), also per the spec —
players below it get basic stats written but no metrics or NIL, same as
before, just a higher bar.

**Not yet implemented**: Shot Difficulty, Adjusted SEI, and Shot Creation
(also in the BTP Metrics Spec) are blocked on "assisted share of makes" per
shot zone (rim/mid/three) — that data isn't in the Torvik CSV pipeline
(checked all 67 columns) and isn't derivable from what's there. Schema is
prepped ahead of it (`assisted_pct_three`/`_rim`/`_mid`, `shot_difficulty`,
`shot_difficulty_modifier`, `adjusted_sei`, `sei_diff`, `shot_creation` —
`player_stats`/`w_player_stats`, see the Prerequisites block atop
`torvik_metrics.py`/`torvik_metrics_w.py`), but no `compute_*` function
reads or writes them yet — that's waiting on a new Torvik CSV pipeline that
actually carries assisted-share data. Once that CSV's real column names are
known, wire the raw `assisted_pct_*` columns up from it and implement the
three formulas per the spec (section 3-5) — don't invent placeholder CSV
column names in the meantime.

---

## Men's vs women's basketball — the fork model

The app supports two sports. **They do not share a code path.** Each sport
has its own pages, its own data hook, and its own scoring constants.

| Sport   | Pages                    | Data hook               | Scoring                        | Tables |
|---------|--------------------------|-------------------------|--------------------------------|--------|
| Men's   | `src/pages/*.jsx`        | `useRosterBoard`        | `@/lib/positions` + inlined weights in `AppPage.jsx` | `players`, `vw_players`, … |
| Women's | `src/pages/womens/*.jsx` | `useWomensRosterBoard`  | same shared module             | `w_players`, `vw_w_players`, … |

Note: `src/lib/scoring.js` exports a `WOMENS_SCORING_CONFIG` that **nothing
imports**, and its coefficients have drifted from the live inlined ones. Don't
treat it as a source of truth — it's a leftover.

Several things once forked have since been merged and are now shared, driven by
a `sport` prop or config rather than duplicated files: `useRosterBoard` /
`useWomensRosterBoard` (one factory), `BoardPage`, and `PortalRankingsPage`.
`AppPage` remains genuinely forked.

Pages currently forked: `AppPage`, `BoardPage`, `ComparePage`, `PortalRankingsPage`, `InternationalPage`. Exports are prefixed `Womens*`. Add new forks to `M_TO_W` in `SiteHeader.jsx` and the routes in `main.jsx`.

Why forked and not toggle-driven:
- Women's NIL valuations and stat weights diverge from men's by design; a
  single shared scorer would need conditional branches everywhere.
- Forking keeps the men's code path verifiably untouched as women's evolves.
- Cost is that bug fixes must be ported across both sides. Track it.

**Rules:**
1. Never have a women's page import from `useRosterBoard`, and never have a
   men's page import from `useWomensRosterBoard`. Cross-imports are a bug.
2. Never have a men's-side file reference a `w_*` table, and vice versa.
   `grep w_players src/` should only show women's-side files.
3. Reusable, sport-agnostic pieces (components in `src/components/`, display
   utilities in `src/lib/display.js`, the team lookup helper, etc.) stay
   shared. If something becomes sport-specific, fork it explicitly.
4. The M/W toggle in `SiteHeader` derives sport from the URL (`/w/*` means
   women's) and navigates between corresponding pages. No global context.
5. Women's localStorage / sessionStorage keys are prefixed `bp_w_` so a user
   switching sports doesn't see cross-pollinated state.

**When you fork a new page:**
1. Copy `src/pages/<Name>.jsx` → `src/pages/womens/<Name>.jsx`, rename the
   export with a `Womens` prefix.
2. Swap any data-hook imports to the women's variant (create one if needed).
3. Swap any scoring imports to `WOMENS_SCORING_CONFIG`.
4. Add a lazy route under `/w/<path>` in `src/main.jsx`.
5. Add the path-pair to `M_TO_W` in `SiteHeader.jsx` so the toggle navigates.

---

## Season rollover: clearing the board vs. the Time Machine archive

There's no season dimension on the live tables — `players`/`w_players` and
`vw_players`/`vw_w_players` are just "current state," continuously
overwritten by the nightly Torvik pipeline. The season-specific state that
needs resetting at rollover is `player_status` (returning/graduating/
transferring/declared/drafted), `portal_transfers`/`w_portal_transfers`, and
`on_board` — a boolean on `players`/`w_players` (`supabase/add_on_board_column.sql`)
that `vw_players`/`vw_w_players` filter on (`supabase/add_on_board_to_views.sql`).
`on_board` is what actually empties the board — clearing `player_status` alone
only resets admin/portal metadata, the row (and everything it shows) still
renders everywhere else that reads the view.

Deliberately a flag, not a delete and not a separate join table: deleting the
row would break `torvik_metrics.py`'s (name, team) matching next season and
lose espn_id/archetype work; a join table (e.g. `season_rosters(player_id,
season_year, on_board)`) would just duplicate what `season_board_archive`
already tracks — two places that can answer "was this player on the board in
season X" is worse than one. A player is on the board or not, right now,
singular — that's a 1:1 attribute of the row, which is what a column is for.
Every write path that creates or updates a `players`/`w_players` row for a
new season (`scraper_to_supabase.py`, `import_portal.py`, `torvik_metrics.py`
/ `torvik_metrics_w.py`, `import_w_torvik.py`) sets `on_board = true` — a
player reappears exactly when the new season's pipeline actually confirms
them, not before. Anyone it never touches (graduated, drafted, left) just
stays off the board, no cleanup step needed.

`archive_season.py` snapshots the live board (stats, archetypes, tags,
transfer status/destination, NIL — everything a board row shows, not just
bare Torvik metrics) into `season_board_archive`/`w_season_board_archive`
(see `supabase/season_board_archive.sql`) before anything gets cleared.
Archiving is always safe to re-run (idempotent upsert). Actually clearing
the live board (`--reset-live`: sets `on_board = false` for everyone, clears
`player_status`, deletes that season's `portal_transfers`) is separate,
explicit, and requires typing the season year to confirm — it is not
reversible from the script itself, the archive it just wrote is the only
copy of what gets cleared.

This is a different table from `historical_stats` (`supabase/historical.sql`)
on purpose: `historical_stats` is a deliberately bare, stats-only archive
with no portal/archetype/tag data, isolated from the live app by design, and
pre-dates all of that being tracked. Don't try to unify them — `season_board_archive`
covers 2026+ (when this mechanism was introduced); `historical_stats` covers
2009–2025 and nothing more will ever be collected for those seasons.

**Time Machine (`HistoricalPage.jsx`) is a thin wrapper, not a parallel
implementation.** For an archived (2026+) season it renders `BoardPage` with
a `season` prop, which switches `BoardPage` into a read-only mode: players
load from the archive table instead of `vw_players`, and every
roster-builder affordance (Shortlist/Roster buttons, the admin
team-switcher, status editing) is hidden. This reuses the real filter/
search/card/table engine instead of hand-duplicating it — don't build a
second copy of that UI here or in any other read-only view; add another
prop to `BoardPage` instead, the same way `season`/`title`/`headerExtra`
were added. Pre-2026 years still render the original bare `historical_stats`
table (`LegacyHistoricalBoard` in the same file) since there's no richer
data to show for them.
