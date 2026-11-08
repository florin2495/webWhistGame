# HANDOFF - Whist (007_Whist), 2026-11-08

Autonomous note for the next agent (Opus 5.5). Read `CLAUDE.md`, `AGENTS.md` (Next.js has breaking changes: read
`node_modules/next/dist/docs/` before writing code) and `D:\_DEv\FEEDBACK_PLAN.md` (contracts A-D, shared rules).
Other sessions: coordinator = `local_3ff01623-91e8-4a81-8b2e-a2e3ecbbeb86` ("Feedback și bug-uri jocuri"). Notes folder:
`C:\Users\andre\AppData\Local\Claude-Data\claude_pzs8sxrjxfjjc\side-session-notes\local_3ff01623-91e8-4a81-8b2e-a2e3ecbbeb86`.

## 1. Original prompt and messages received

### Initial prompt (from the coordinator session, in Romanian, verbatim in substance)
Whist (007_Whist) is one of 12 separate repos (hub + 11 games) on one Supabase project. Common plan and contracts:
`D:\_DEv\FEEDBACK_PLAN.md`. Each repo has its own agent; I was the Whist agent.
Task: read FEEDBACK_PLAN.md (rules, contracts A-D, section for games without special tasks), then CLAUDE.md/AGENTS.md.
Implement here contracts A (host reorder), B (spectator + "Intră la runda următoare", max 16), C (leaderboard reporting,
code ready but NOT pushed until the user runs the hub migration) and D (iOS bugs: look for the fix in the plan's
"Fix iOS" section; if empty do A/B/C first and re-check at the end; if still empty investigate).
Rules: no `git push`, bump patch in `package.json`, numbered additive migrations with the game prefix, run `npm test`,
`npx tsc --noEmit`, `npx eslint src`, `npx next build`. Git identity is already pinned, do not change it. Commit on `main`
in small steps. Final report: what was done, migrations to run, what was not verified.

### Message 1 (coordinator): migrations process change
Do not ask the user to run anything, just write the file. The user wants ONE single SQL script with all migrations from all
repos, assembled by the coordinator. Migrations must be idempotent (`create table if not exists`, `add column if not
exists`, `create index if not exists`, guarded constraints), no `drop`/`delete` of data. Do not block waiting for it to run.
Final report must list the exact path of each migration file created.

### Message 2 (Septica session): layout "variant A" for Whist
Septica session says the user wants Septica's "variant A" table layout in Whist too "if there is no clear seat order already".
Approved mock (per that session, NOT confirmed by the user to me): `D:\_DEv\008_Septica\docs\mock\septica-layout.html`:
cross-shaped table, current player bottom, left = next, top = 3rd/partner, right = previous, played cards in front of each
seat, badges "a început"/"urmează"; 3 players: left+right only; 2: top only. Septica implementation (reference, when done):
`D:\_DEv\008_Septica\src\components\Game.tsx`.
**My decision: did nothing.** Whist already shows seats in play order (Seats panel in `src/components/Game.tsx`, dealer badge,
turn marker) and a green table with the played cards. A permission/approval for a redesign must come from the user. Message 3
below (3-6 player layout) supersedes this for the layout work: do it as ONE new table layout (see section 3), and take
Septica's mock only as visual reference.

### Message 3 (coordinator): NEW TASK, 3 to 6 players (NOT STARTED)
Game must accept 3-6 players (now `MAX_PLAYERS = 4` in `src/lib/whist.ts`).
1. Rules: adapt dealing and number of hands for 5 and 6 players (52-card deck does not divide equally; choose the standard
   Whist / Romanian Whist variant, e.g. remove low cards so the deal is exact, max hand limited to what fits). Update
   `handSizes`, validations in `start`/`new-round`/`join`, and tests. In the report state exactly which rules were chosen for
   5 and 6 and why, so the user can correct them.
2. Table layout (current player always at the bottom, play order clockwise starting from my left):
   - 6 players: me bottom; left = next 2 (stacked); top = 1 player (the 4th); right = last 2 (stacked).
   - 5 players: me bottom alone; left = 1; right = 1; top = 2 players.
   - 3 and 4 stay as now (or left/top/right, whichever is already implemented).
   Must fit portrait mobile (~390 px): my cards stay readable, opponents compact (name, cards count, bid/score).
3. Ties in with B (spectators) and A (reorder): seats are assigned in the saved order.
Do not block other tasks; same set of small commits.

### Message 4 (coordinator): hand-off
Finish current atomic step, write `docs/HANDOFF.md`, commit it (no push), reply with exact path + 3-line summary, then stop.

## 2. Done so far (all on `main`, NOT pushed)

| Commit | What |
| --- | --- |
| `3a61a8a` | feat: spectators, join queue, host play order (contracts A + B), migration 003 |
| `aa9d9de` | feat: report finished games to hub leaderboard (contract C) |
| `52e1da2` | fix(ios): feedback modal + viewport (contract D) |
| `38a0824` | chore: v0.3.5, CLAUDE.md migration table + leaderboard hold note |

Details:
- A: `POST /api/rooms/[code]/reorder` (host, lobby only, full permutation checked by `isPermutation`, writes `whist_players.seat`);
  ▲▼ buttons in `src/components/PlayerList.tsx`. `start` seats players exactly in `seat` order (old `seatOrder` deleted);
  `new-round` rotates the opener by one (`nextRoundOrder` in `src/lib/spectators.ts`), host can reorder afterwards.
- B: join into a `playing` room or a full lobby -> `role='spectator'` (max `MAX_SPECTATORS=16`, 409 above). `POST /queue` toggles
  `queued_at`; `new-round` promotes queued spectators in queue order while `players < MAX_PLAYERS`. `/state` returns `spectators`
  and `role`/`queued` on each `PublicPlayer`; UI in `src/components/Spectators.tsx` (banner + button + list + host kick).
  `removePlayer` (`src/lib/server/membership.ts`) works on all members; host passes to next player, a spectator only if nobody
  else is left (then promoted to player). Rejoin works unchanged (role kept).
- C: `src/lib/server/leaderboard.ts`, called from `src/lib/server/move.ts` when a game ends and is not aborted. Inserts
  `hub_leaderboard_rounds(game='whist', room_code, round_no=room.round)` first (duplicate = already counted), then select+upsert
  `hub_leaderboard` per player (`player_key` = lowercased nickname). Winners = `leaders(scores)`. Errors only logged.
- D: plan's "Fix iOS" section (by Bingo agent) applied identically: feedback overlay scrollable + dialog at top with safe-area,
  removed programmatic textarea focus, `maximumScale: 1`, `text-size-adjust`, `body { overflow-x: clip }`.
- 5/6 players: **nothing done**.

## 3. Remaining, in order
1. 3-6 players rules (`src/lib/whist.ts`: `MIN_PLAYERS`/`MAX_PLAYERS`, `handSizes`, deck/deal; check `deal`, `legalCards`,
   `allowedBids`, dealer/first seat helpers, `newGame` validation message, `MAX_HAND`). Update tests in `src/lib/whist.test.ts`
   (includes a full random game: run it for 3,4,5,6). Update texts that say "3 sau 4"/"3-4" (start route, Lobby, README, manifest/
   layout description). `nextRoundOrder(…, MAX_PLAYERS)` and join's `players.length >= MAX_PLAYERS` already follow the constant.
   Lobby count/`canStart` use the constants too. Check the `whist_rooms`/schema has no player-count constraint (it has none).
2. Table layout for 5/6 players in `src/components/Game.tsx` (`Seats` + `Table`): see message 3. Compute seat position relative to
   `g.mySeat` (clockwise from my left); spectators (`mySeat === null`) need a fallback (seat 0 at bottom). Keep it compact for 390 px.
   Variant-A mock from Septica is optional visual reference only.
3. Verify in a browser at 390 px (dev server via `preview_start`), with 3, 4, 5, 6 players. Needs migration 003 applied to the DB used.
4. Bump patch version (`package.json` + `npm install --package-lock-only`), update CLAUDE.md, commit small, no push.
5. Final report to coordinator: chosen 5/6 rules and why, exact migration paths, what was not verified.

## 4. Decisions and reasons
- Seat order is persisted in `whist_players.seat` (host reorder) and used verbatim by `start`; the rotation per round moved from
  `seatOrder` into `new-round` so the opener still changes every game but the host's order survives.
- Spectator = `role` column on `whist_players` (not a new table) so token auth, presence and rejoin work unchanged.
- Full lobby also makes newcomers spectators (not 409), because there is no other way to watch/queue.
- Leaderboard select+upsert is not atomic (hub schema has no RPC): a race for the same nickname in two simultaneous finishes can lose a +1. Accepted.
- Rules for 5 and 6 players: **not chosen yet.** Suggestion to evaluate: with 52 cards, use 5 players x max 10 cards (50) and
  6 players x max 8 cards (48), dropping lowest cards (2s, plus 3s for... check) so every hand size up to the max deals exactly,
  keeping the trump card turned from the remaining deck (needs at least 1 spare card for hands below the max). Verify the
  trump-card requirement when hand size x players = deck size. Document the final choice in the report.

## 5. Migrations created
- `D:\_DEv\007_Whist\supabase\migrations\003_spectators_order.sql` (idempotent: `add column if not exists`, guarded constraint,
  backfill only where `seat is null`). Same change folded into `D:\_DEv\007_Whist\supabase\schema.sql`.
- Earlier ones (already applied live): `001_pending_kick.sql`, `002_reconnect.sql`.
- Needs from the hub (not mine): `000_Startup/supabase/migrations/002_hub_leaderboard.sql` (`hub_leaderboard*`). Needed before pushing.
- 5/6 players need no migration unless a constraint is found.

## 6. Pitfalls, unverified, state
- Do NOT push: migration 003 and the hub leaderboard migration must be in the single script the user runs first; push = deploy.
- `RouteContext<"/api/rooms/[code]/x">` types for new routes appear only after `npx next build` (or dev): run build before `tsc`.
- Not verified at all: any live/e2e run of spectators, queue, reorder, new-round promotion (DB lacks migration 003); iPhone
  behaviour of the iOS fix; browser rendering of the new UI. `scripts/e2e.mjs` is untracked (pre-existing), was not extended.
- Existing files use CRLF; git warns about LF conversion, harmless.
- State at handoff: `npm test` 29 passed, `npx tsc --noEmit` clean, `npx eslint src` clean, `npx next build` OK (before this doc).
- Git: clean except untracked `scripts/`. Version 0.3.5.
