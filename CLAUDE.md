@AGENTS.md

# webWhistGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webWhistGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by hand by the user; served at https://games.hailatat.icu/whist (`basePath`; the hub proxies it to web-whist-game.vercel.app)
- Functions run in `fra1` (Frankfurt, `vercel.json`), next to the Supabase DB.
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `whist`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project, same as the other hub games)
Migrations are run by hand in the Supabase SQL editor - nothing records them in the DB,
so this list is the source of truth. **Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes (2026-11-07, verified: service role 200, anon 42501) | `whist_rooms`, `whist_players` |
| `supabase/migrations/001_pending_kick.sql` | yes (2026-11-07, verified) | `whist_players.kick_requested_at` (kick during a game waits 10 s, can be ignored). Do not push before it is applied |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `whist_players.last_seen_at`, `device_hash` + index (rejoin the same seat). Do not push before it is applied |
| `supabase/migrations/003_spectators_order.sql` | yes (user ran `ALL_MIGRATIONS.sql` on 2026-11-08, not re-verified by effect) | `whist_players.role` (player/spectator), `seat` (play order, host reorders), `queued_at` (spectator queue). Do not push before it is applied |

Rules for schema changes:
- Every object of this game is prefixed `whist_` (tables, constraints, indexes). Table names live in `T`
  in `src/lib/server/db.ts`.
- New migration = new numbered file in `supabase/migrations/`, additive when possible, and the same change
  folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

## Design
- 3-6 players (`MAX_PLAYERS = 6`): the deck is always the 8 highest cards of each suit per player (3: 9..A, 4: 7..A, 5: 5..A, 6: 3..A), same 1-8-1 / 8-1-8 sequence, 3n+12 hands; 8-card hands have no trump.
  Table layout (viewer at the bottom, clockwise from their left) is `src/lib/tableLayout.ts`.
- Pure rules in `src/lib/whist.ts` (deal, bid, play, score). The whole game state, hands included, is one
  jsonb column `whist_rooms.game`, written with an optimistic lock on `whist_rooms.version` (`saveRoom`).
- `/state` returns only the caller's own cards (`publicGame` in `src/lib/server/room.ts`).
- Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (≤ every 10 s);
  re-joining with an existing nickname reclaims that seat (new token) from the same device (`device_hash`) or once
  the seat has been unseen for 45 s, also mid-game. `/state` exposes only a derived `connected` flag.
- Realtime: Broadcast topic `whist:room:<uuid>` carries no data, clients re-fetch `/state`; 15 s polling fallback.

## Abandoned rooms (120 s)
- `GET /api/rooms` (the room list behind "Intră în cameră") also runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
  every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (120 s, `whist.ts`)
  and with no member (player or spectator, both `whist_players` rows) `last_seen_at` within 120 s is deleted (members cascade).
  Open room pages keep both fresh (`/state` polls every 15 s, touches `last_seen_at` ≤ 10 s and `last_activity_at` ≤ 20 s),
  so only rooms nobody has open disappear. The 10 / 60-minute idle expiry stays too.

## Spectators, order, leaderboard
- Joining a running game (or a full lobby) makes you a spectator (max 16, `lib/spectators.ts`); `POST /queue` toggles
  "Intră la runda următoare"; `new-round` promotes queued spectators in queue order, rotates the opener and keeps the host's order.
- `POST /reorder` (host, lobby only) sets `whist_players.seat`; `start` seats players in exactly that order.
- Finished games are reported to the hub's `hub_leaderboard` / `hub_leaderboard_rounds` (`lib/server/leaderboard.ts`, idempotent per
  room code + round). The hub migration `002_hub_leaderboard.sql` has been run (failures are only logged). `LEADERBOARD_GAME` env var overrides the slug for local tests (`whist-test`).

## Testing (GitHub Actions, manual only)
All checks run in GitHub Actions on the free tier (public repo, standard `ubuntu-latest` runners only, never billed
runners), never locally (user's rule, see `D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch`
only (no automatic trigger): nothing gates a push, and Vercel deploys `main` regardless.
Start one with `gh workflow run <file> --ref main`, then `gh run watch` (or the Actions tab, "Run workflow").
| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (also type-checks `tests/ui` and `playwright.config.ts`), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest: `src/lib/whist.test.ts` incl. a full random game, `kick`, `reconnect`, `spectators`, `tableLayout` tests; pure logic, no DB) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/whist`), then `node scripts/e2e-multi.mjs <base_url> <n> <hands>` for each n of the `multi_players` input (default `4 5 6`, empty = skip) with `multi_hands` hands (default 4, `all` = whole game, slow with 6). One run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit). Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (cleanup safety net and the
  leaderboard checks; locally the scripts fall back to `.env.local`). It checks that the deployed client JS contains the
  `package.json` version of the checked-out ref, so run it on `main` after the Vercel deploy of that version has finished.
- What `e2e.mjs` does: page / `_next` assets / version / manifest / icons / `room/XXXXXX` over HTTP and that
  `web-whist-game.vercel.app/whist` serves the same build, then the real API (production DB): create (password), wrong /
  missing password, same nickname from another device = 409, 6 players + a 7th = spectator, room list, settings, auth
  errors, rejoin (same device, old token dead), lobby kicks, host reorder (seats follow it), start, out-of-turn / illegal
  bids and cards, dealer rule, spectators mid-game (no cards, 403 on moves, queue, rejoin, immediate kick), pending kick
  with "Ignoră", rejoin mid-game, concurrent double play, a whole 3-player game with the score sheet recomputed and the
  hub leaderboard report checked, new round (order rotated, queued spectator promoted), 5-player game (deck 5..A, 27
  hands), enforced kick stopping the game, host leaving passes the host on, last one out closes the room.
- What `e2e-multi.mjs` does (per player count): full lobby -> spectator (6), reorder, seats, 3n+12 hands, deck lowest rank,
  late spectator sees no cards and queues, plays `hands` hands (all screens agree), then a player leaves (game stopped) or,
  with `all`, the game ends and the leaderboard report is checked; new round promotes the queued spectator.
- Both scripts name rooms `e2e-test-…` and nicknames `e2e…`; at the end they delete their rooms and their hub leaderboard
  rows (`hub_leaderboard_rounds` of their room codes, `hub_leaderboard` rows `game=whist`, `player_key like e2e*`). They
  never call `/api/feedback` (only its 400 validation).
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; Whist is random, so the player whose screen says
  "Rândul tău" picks the first enabled bid / card, and after every move every screen must show the same `hand-info`
  `data-progress` within 5 s without a reload; polling is 15 s, so this checks Realtime):
  - `game.e2e.ts` (both projects): three browser contexts (= three devices, Whist needs 3) create a room, join by link,
    deal, bid and play the first 4 hands live, a player leaves (game stopped on the other screens), new game, leave.
  - `spectator.e2e.ts` (desktop Chromium only): a fourth person joins mid-game = spectator (no cards, no bid buttons),
    the players see them, they follow every move of the first hand, queue ("în coadă" seen by the players), see the game
    stop, and the new game makes them a player.
  - `mobile.e2e.ts` (iPhone only): 6 players with 10-character nicknames, no horizontal scroll on home / lobby / game,
    cards and bid buttons >= 24 px, a touch tap places a bid seen live by the other phones.
  Rooms are `e2e-test-ui-…` (no full game, so nothing reaches the leaderboard); a leftover is deleted with the service
  key from the same repo secrets.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- The UI tests find elements by `data-testid`: `home-submit`, `join-submit`, `start-game`, `player-list`, `hand-info`
  (with `data-progress` = `progress()` in `Game.tsx`), `turn-badge`, `bid-picker`, `my-hand`, `game-table`, `last-hand`,
  `game-over`, `new-round`, `leave`, `spectator-banner`, `queue-toggle`, `spectator-list`. Renaming or removing one
  breaks `tests/ui`.
