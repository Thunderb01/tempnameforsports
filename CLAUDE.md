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

**Full Board display bucket is also 4-bucket now** (`LEGACY_BUCKETS` /
`legacyBucketFor()` in this same file): Guard/Wing/Forward/Big, mirroring the
metric peer groups below rather than the old Guard/Wing/Big. `BoardPage.jsx`
(shared men's/women's) is the only consumer. This is a THIRD, independent
bucket system from the five-position eligibility model above and the
backend metric peer groups below — don't conflate the three when changing
one.

Forward requires the **dual** SF+PF eligibility signature (Wing F, or a raw
scraped `"F"` code) — not just a bare single-element SF or PF. An earlier
version of this classified *any* bare SF as Forward (reasoning: "only Wing F
produces a standalone SF primary") and any bare PF-without-C as Forward
(reasoning: "that's the Stretch 4 signature"). Both assumptions were wrong
in practice: a bare `["SF"]` is also exactly what the legacy `"Wing"` bucket
expands to and what `UNKNOWN_POSITION_FALLBACK` produces, and a bare `["PF"]`
(no C) is what most ordinary PF-only bigs carry too, not just Stretch 4 —
Stretch 4 is genuinely indistinguishable from a generic PF-only big in this
five-position data (`torvik_role_to_positions` collapses both the same way).
Since those fallback/legacy/raw-code paths produce single-element lists by
construction, treating bare SF/PF as Forward dumped nearly the entire board
into Forward. Fixed by requiring the eligibility set to contain *both* SF
and PF before calling it Forward; a bare SF falls back to Wing and a bare
PF-without-C falls back to Big, same as the old 3-bucket behavior — Stretch
4 stays coarsely bucketed as Big on the board (a known, accepted imprecision)
rather than guessing.

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

**`pos_bucket` itself must never default straight to one bucket when the
CSV's `role` column is blank.** `df["pos_bucket"] = df["role"].apply(normalise_pos)`
used to do exactly that: `normalise_pos("")` falls through every keyword
check to its own `"Wing"` default, so a precursor CSV with `role` blank for
every row (e.g. `data/trank_data_2027.csv` — blank for all 3260 rows, since
it's seeded from last season's stats before this season's role has been
computed) put **every player in the same bucket**. Every percentile-based
metric and NIL are computed *within* `pos_bucket`, so this wasn't a display
bug — it silently compared guards against centers for every metric, on every
pipeline run against that CSV, until caught. Fixed: `main()` now tries
`_bucket_from_positions(positions)` first, keyed by `torvik_pid` against the
player's already-known `positions` array (from a prior real-role run) —
`normalise_pos`'s `"Wing"` default is only reached when a player has no role
*and* no stored positions either (true last resort, not the common case).
`_bucket_from_positions` mirrors `src/lib/positions.js`'s `legacyBucketFor()`
exactly (same dual-SF+PF-required-for-Forward reasoning — see that file's
docstring) and lives right next to `normalise_pos` in both files.

The five-position model (`torvik_role_to_positions` / `src/lib/positions.js`)
is unrelated to this and wasn't touched — `Wing F` still maps to `["SF", "PF"]`
and `Stretch 4` to `["PF"]` for display/lineup purposes, same as always.

**Minutes cutoff is 20%** (`Min_per >= 20`) for *who counts as the reference
population* — not, as of 2026-11-13, for who gets a rating at all. See
"Shrinkage toward the position average" below: every player gets real
cdi/dds/sei/ath/ris/NIL now, qualified or not.

### Shrinkage toward the position average — every player gets a rating, not just qualified ones

Confirmed 2026-11-12/13: real teams were missing players from the board, and
separately, a low-minutes player's `cdi`/`dds`/`sei`/`ath`/`ris`/NIL used to
come back `None` outright (the `Min_per >= 20%` cutoff gated metrics
entirely, not just display). By request: every player now gets a real
rating, but a small sample's noise still can't swing it the way it would if
their raw stats were trusted outright or let into the comparison pool.

**The mechanism**: `percentrank_by_pos()` (both files) takes an optional
`reference_mask` — when given, the COMPARISON population for every
percentile is restricted to that mask (the qualified pool) regardless of
which rows are being ranked. A low-minutes player's own noisy value can
never distort anyone else's percentile and never becomes part of the
population itself — the same integrity guarantee the old hard cutoff gave,
just without blanking the player's own result. Threaded through every
`percentrank_by_pos` call in `compute_cdi`/`dds`/`sei`/`shot_difficulty`/
`adjusted_sei`/`shot_creation`/`ath`/`ris`/`nil_valuation` (11 internal calls
inside `compute_nil_valuation` alone) in both files.
`compute_dds`'s `pos_avg_drtg` and `compute_shot_difficulty`'s
`pos_avg_difficulty` (population aggregates, not percentiles, computed via
groupby) get the equivalent treatment: computed from the qualified subset
only, then mapped back onto every row including the ones excluded from
computing it.

**Then `shrink_toward_average(raw_score, mp, max_mp, pct=0.25)`** blends
that percentile toward 50 (the position average) by `weight = mp / (mp +
0.25*max_mp)`, where `mp` is the Torvik CSV's own total-minutes-played
column and `max_mp` is the season-high across the current run. A player at
the season-high minutes gets ~80% weight on their own number; a player with
none of the season's minutes yet gets ~0%, i.e. pure average. Scaling the
stabilization point off `max_mp` (not a fixed minutes floor) means this
adapts to how far into the season the data actually is — a fixed threshold
would unfairly shrink everyone, starters included, in the season's first
few weeks, when nobody has played many total minutes yet. 25% was chosen so
a player at roughly a quarter of the season leader's minutes already gets a
50/50 blend with the position average.

Applied in `main()` uniformly to every player, qualified or not — a
qualified player's own minutes are already close to `max_mp`, so this
barely moves their number; this is also why the qualified/low-minutes split
and the old "basic stats only, no metrics" write loop are gone entirely —
one unified write loop now handles everyone. NIL inherits the shrinkage
through its five biggest inputs (it reads `df["_cdi"]` etc., already shrunk
by the time `compute_nil_valuation` runs); NIL's own minor internal
sub-scores (def/iq/motor/size/lateral/versatility) still rank against the
qualified reference so they can't be corrupted by a low-minutes player's
presence, but aren't individually re-shrunk given their small combined
weight next to the five that already are.

**A real index-alignment bug surfaced building this**: `qualified_mask`
must be computed AFTER the Supabase merges and the `reset_index` that
follows them, not before — `df.merge()` always returns a fresh `0..N-1`
index, and a mask built against the pre-merge index would silently
misalign (pandas aligns boolean Series by label, not position) the moment
`df`'s index changed under it. If you ever see a `reference_mask` or
similar boolean Series produce nonsensical results after a `merge()`,
check this first.

### Shot Difficulty, Adjusted SEI, Shot Creation — the assisted-share data source

The missing input was "assisted share of makes" per shot zone (rim/mid/
three) — not in the standard Torvik CSV, confirmed by checking all 67
columns. It comes from a *separate* Barttorvik endpoint:
`https://barttorvik.com/{year}_pbp_playerstat_array.json?csv=1` — an array
of 15-element arrays, no field names:
`[torvik_pid, name, school, rim_made, rim_missed, rim_assisted, mid_made,
mid_missed, mid_assisted, three_made, three_missed, three_assisted,
dunk_made, dunk_missed, dunk_assisted]`. The leading integer is confirmed
(cross-referenced against a real CSV) to be the same `torvik_pid` already
stored on `players`/`w_players` — match directly on it, no fuzzy name/team
matching needed.

Barttorvik tracks dunks as a category **separate** from rim (confirmed:
dunk/rim counts don't overlap in this data), but the spec's "rim" bucket is
explicitly "includes dunks" — `import_pbp_shot_assists.py` sums
`dunk_made/missed/assisted` into the rim numbers before computing
`assisted_pct_rim`; `torvik_metrics.py`'s `_shot_bucket_attempts()` sums the
CSV's `rimmade+rimmiss` and `dunksmiss+dunksmade` the same way, so both
sides agree on what "rim" means.

**Pipeline order: `import_pbp_shot_assists.py` runs first, `torvik_metrics.py`
second — one pass each, not a two-pass dance.** `import_pbp_shot_assists.py`
matches by `torvik_pid` and either `UPDATE`s an existing `player_stats`/
`w_player_stats` row (if one exists for that `calendar_year`) or `INSERT`s a
sparse one (`player_id`, `calendar_year`, `name`, `school`, and the three
`assisted_pct_*` columns — nothing else) when it doesn't. `torvik_metrics.py`
then finds that row (sparse or full) via its own `(player_id, calendar_year)`
lookup and `UPDATE`s it with cdi/dds/sei/etc — a Supabase `.update()` only
touches the keys in its own patch, so the `assisted_pct_*` values already
there are untouched, and this single `torvik_metrics.py` run picks them up
and computes Shot Difficulty/Adjusted SEI/Shot Creation correctly:

```bash
python import_pbp_shot_assists.py --season <year> --json <pbp file>
python torvik_metrics.py --csv <csv> --year <year>
```

**`run_season_pipeline.py` runs this full sequence (plus `--repair-departed-on-board`
and `team_players` resync) in one command instead of by hand** — the actual
recurring failure mode across several seasons of doing this manually wasn't
any one script being wrong, it was a step skipped, run out of order, or the
frontend `sessionBoardVer` bump forgotten (see "State that's local vs.
shared" above). It wraps the existing scripts as subprocesses rather than
reimplementing them, stops immediately on the first failing step, and
auto-bumps `sessionBoardVer` as its last step so that's never the forgotten
part again:

```bash
python run_season_pipeline.py --year <year> --csv <csv> --pbp-json <pbp file> --dry-run
python run_season_pipeline.py --year <year> --csv <csv> --pbp-json <pbp file>
```

`--fetch` downloads the trank CSV live via `torvik_to_csv.py`
(`barttorvik.com/getadvstats.php`) instead of requiring `--csv`. Confirmed
2026-11-11: barttorvik.com 403s requests from GitHub-hosted Actions runner
IPs (cloud/datacenter ASNs are a common anti-bot target) — `torvik_to_csv.py`
already sends a browser-like `User-Agent`, so this is IP-range blocking, not
a fixable header/code issue. That means `--fetch` run from an ordinary
residential connection (your own machine) isn't subject to it — still worth
a `--fetch --dry-run` once to confirm before trusting it for a real run.
Women's has no `team_players`-equivalent sync script yet (a pre-existing
gap — see the fork-model section) and no live-fetch endpoint either (`data/
trank_ncaaw_2026.csv` is a one-time seed, not a refreshable live source), so
`--fetch` and the team_players step are men's-only for now.

**Automation decision (2026-11-11): manual-but-streamlined, not scheduled.**
A GitHub Actions workflow automating this on a schedule was built, then
abandoned after the IP-blocking discovery above — a GitHub-hosted runner
can't do the live fetch at all, and a self-hosted runner (the workaround)
was decided against as more infra than it's worth right now. Instead,
`run_season_pipeline.py` itself got the safety/convenience features that
workflow would have had, so a manual run is as close to one-command as it
gets:
- **Every run validates the CSV's shape** — row count, `pid` non-null rate,
  `Min_per` distribution — before anything writes to Supabase, whether the
  CSV came from `--fetch` or `--csv` (`validate_csv_shape()`). This is the
  guard that would have caught the two incidents below (a CSV whose columns
  silently ended up misaligned without crashing) before either reached
  production — now it protects every run, not just an automated one.
- **`.env.local` support** (`python-dotenv`, optional — falls back to
  whatever's already in your shell if not installed) means `SUPABASE_URL`/
  `SUPABASE_SERVICE_KEY` don't need re-exporting every new terminal session —
  same `.env.local` file the frontend's `VITE_SUPABASE_*` vars already live
  in, so there's one env file for the repo, not two; see `.env.example`.
- **`--git-push`** commits the refreshed CSV + diagnostic files +
  `sessionBoardVer` bump and pushes once the run succeeds, so publishing is
  part of the same command instead of a separate manual step.
- Putting it together: `python run_season_pipeline.py --year <year> --fetch
  --git-push` is the whole refresh, end to end, one command, entirely on
  your own machine — no GitHub Actions involved at all.

**Barttorvik's trank CSV exports have NO header row — confirmed against a
real production `KeyError: 'player_name'` crash (2026-11-08), not a guess.**
Every trank CSV barttorvik.com hands out — `getadvstats.php?csv=1` fetched
live, or the same file downloaded by hand — starts straight with row data,
no `player_name,team,conf,...` line first. Plain `pd.read_csv()` silently
promotes the first player's row to column names, so every
`df["player_name"]`-style lookup downstream throws `KeyError`, right after
the row count prints (easy to mistake for a late failure when it's actually
read-time). `torvik_metrics.py`/`torvik_metrics_w.py` and `torvik_to_csv.py`
guard against this: `TRANK_BASE_COLUMNS` holds the known 67-column schema,
extended with `unk_N` placeholders for trailing columns past that (Barttorvik's
column count has moved — 67/68/78 observed across different exports).
`read_trank_csv(path)` (both metrics files, used at every CSV-from-disk read
site) and `parse_trank_response(text)` (`torvik_to_csv.py`, used on the live
HTTP body so `--fetch` always produces an already-headered file) check the
first row/line for a literal `player_name` first column and only apply the
schema when it's missing. Any new code path that reads a trank CSV — from
disk or over HTTP — must go through one of these two functions, never a bare
`pd.read_csv()`, the same way name/team lookups must go through their own
canonical helpers (see the table at the top of this file).

**A header row being present is not enough — it can still be the wrong
length, and that's worse than no header at all.** Confirmed against a second
real production incident (2026-11-08, same day): a pushed `data/trank_data_2027.csv`
had a header naming only the base 67 columns while every data row actually
had 78 fields. `read_trank_csv()`/`parse_trank_response()` correctly saw
`player_name` in the first field and took the "has a header" branch — which
at the time just called plain `pd.read_csv()`. That hits an undocumented
pandas footgun: when a header is *shorter* than the data rows, pandas
silently consumes the extra leading fields as an unnamed index instead of
erroring. Every named column then read 11 positions to the right of where
it actually was — `pid` came back garbage for 4169/4179 rows and `Min_per`
silently read a 0–1 ratio column instead of the real percentage. Unlike the
missing-header case this doesn't crash; it runs clean and corrupts silently.
In production it took out the whole board in one command: `torvik_metrics.py`
found 0 qualified players (nothing cleared `Min_per >= 20` once the column
was wrong), and `--repair-departed-on-board` saw only 10 valid pids in a
2767+-row file, so it reverted ~2464 real `on_board=true` players to `false`
and `team_players` rebuilt itself with 0 rows. Fixed: both functions now
*never* let pandas infer column count from the header row at all — they
always measure a data row's width and pass an explicit `names=` list sized
to that, whether the header is missing, short, or a correct length. Recovery
for an incident like this doesn't need manual DB surgery: once the CSV is
read correctly, a normal `torvik_metrics.py --csv ...` run sets `on_board =
true` for every player it actually matches (see "Season rollover" below), so
re-running the pipeline against the same (now correctly-read) file is the
designed fix, not a one-off patch.

Missing `assisted_pct_*` data (a player the PBP importer never saw, or one
with 0 makes in a bucket) is treated as `0` — "fully unassisted" — per the
spec's own edge-case rule, not an error.

All three formulas (`compute_shot_difficulty`, `compute_adjusted_sei`,
`compute_shot_creation` in both `torvik_metrics.py` and `torvik_metrics_w.py`)
are implemented per spec sections 3-5, verified against real 2025-26 data
(CSV + PBP JSON for that season). Shot Difficulty's clamp bounds (0.9/1.1)
print a diagnostic count of players hitting each limit when the pipeline
runs — spec note: "a large number means the range needs widening." The
spec's "ignore rim for Bigs" Shot Creation variant is explicitly a *test*
variant, not implemented as default behavior.

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

## New players: `torvik_metrics.py` creates them now, not just `scraper_to_supabase.py`

Confirmed 2026-11-12: "this season's freshmen aren't showing up on the board"
traced back to `torvik_metrics.py`/`torvik_metrics_w.py` only ever **updating**
an existing `players`/`w_players` row (matched by `torvik_pid` or name+team via
`match_utils`) — any player with no existing row got logged to
`unmatched_players.csv` and silently dropped, no matter how much they played.
The only path that ever created new rows was `scraper_to_supabase.py`, a
*separate* Sports-Reference scrape never wired into `run_season_pipeline.py`.
Real impact at the time: 931 unmatched players across 323 of ~364 D1 teams —
450 Freshman, 205 Junior, 141 Sophomore, 135 Senior. Not exclusively
freshmen (anyone never scraped in shows up this way), but by far the
largest group, since they're the players most likely to be new to the DB.

Fixed, by explicit choice — Torvik as the single source of truth, no second,
differently-spelled source (`scraper_to_supabase.py`'s `source: "program"`
rows use Sports-Reference's own name/team spelling, exactly the cross-source
mismatch risk this avoids): when no match is found, both files now **insert**
a new row directly from the Torvik CSV row (`name`, `current_team`,
`torvik_pid`, `source: "torvik"`, `on_board: true`) and fall through into the
existing matched-player path, which fills in positions/year/height/NIL via
the same `player_patch` `UPDATE` every existing player already gets — no
duplicated field-population logic for new rows. The low-minutes write loop
(separate code path, "no metrics, no NIL") gets its own copy of this since it
never otherwise touches the players table for an existing match either —
there's no later patch to fall through into there.

Creation is gated off (falls back to the old log-and-skip behavior) under
`--skip-team-sync` and `--historical` — neither is a trustworthy signal that
a player is actually on this season's live roster, and creating a new
`on_board=true` row from either would be the exact mistake
`repair_departed_on_board()` exists to undo (see below).

**Weight is intentionally left blank** on newly created rows: confirmed unused
everywhere at the time of this fix — `compute_ath()`'s own comment claims it
reads `_weight_pct`, but the function never actually does, and no frontend
component displays player weight at all. No payoff yet for a second-source
lookup Torvik's CSV can't provide on its own (it has no weight column;
`ht`/height is available and used). Revisit together if weight ever actually
gets wired into a metric or a player card.

**`compute_ath()` in both files had the same underlying bug class**, found
while building an end-to-end test for the fix above: it unconditionally read
`df["sb_drb_40"]` with no column-existence guard, crashing whenever the
Supabase `player_stats` merge returns zero rows — not just under `--dry-run`
(that part was already broken; confirmed separately the same day as a
`KeyError: 'sb_tot_ast'` crash in `compute_cdi()`/`compute_ris()`, same root
cause, same fix). All of these now guard every `sb_*` access and fall back to
the Torvik-only equivalent, matching the pattern `compute_dds()` already used
correctly. Any new formula reading an `sb_*` column must guard it the same
way — the Supabase merge is best-effort, never guaranteed to populate it.

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
