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

Why this matters: `vw_players.current_team` carries strings like
`"Murray State"` while the JSON keys it as `"Murray St."`, and stale player
metadata can leak `"UC Santa Barbara (2 Yrs)"` into supposedly clean fields.
The helper normalizes (trailing parens, `Saint`/`St.`, `State`/`St.`, periods,
case) and resolves an `EXPLICIT_ALIASES` map for cases regex can't handle
(Loyola Chicago vs Loyola (IL), Miami FL vs Miami OH, UNC vs North Carolina,
UConn vs Connecticut, BYU, etc.).

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

## Scoring math (Roster Strength)

Static-team scoring and the user's live build run through the SAME function
(`scoreTeamPlayers`). Only the lineup differs:

- **Static** = canonical 2 Guards + 2 Wings + 1 Big.
- **Live**   = the user's sidebar (`starterCounts`).

Slot weights inside each position bucket:
`1.00` for starter slots, `0.20` for the next 3 off the bench, `0.04` for
deeper depth. International players are excluded from both pools.

If you add a third "score view," reuse `scoreTeamPlayers` rather than
re-implementing the weighting — it lives in `src/pages/AppPage.jsx`.

---

## Men's vs women's basketball — the fork model

The app supports two sports. **They do not share a code path.** Each sport
has its own pages, its own data hook, and its own scoring constants.

| Sport   | Pages                    | Data hook               | Scoring                                       | Tables |
|---------|--------------------------|-------------------------|-----------------------------------------------|--------|
| Men's   | `src/pages/*.jsx`        | `useRosterBoard`        | inlined in `AppPage.jsx`                      | `players`, `vw_players`, `portal_transfers`, … |
| Women's | `src/pages/womens/*.jsx` | `useWomensRosterBoard`  | `WOMENS_SCORING_CONFIG` from `@/lib/scoring`  | `w_players`, `vw_w_players`, `w_portal_transfers`, … |

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
