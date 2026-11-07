@AGENTS.md

# webWhistGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webWhistGame`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by hand by the user; production domain: https://whist.hailatat.icu
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

Rules for schema changes:
- Every object of this game is prefixed `whist_` (tables, constraints, indexes). Table names live in `T`
  in `src/lib/server/db.ts`.
- New migration = new numbered file in `supabase/migrations/`, additive when possible, and the same change
  folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

## Design
- Pure rules in `src/lib/whist.ts` (deal, bid, play, score). The whole game state, hands included, is one
  jsonb column `whist_rooms.game`, written with an optimistic lock on `whist_rooms.version` (`saveRoom`).
- `/state` returns only the caller's own cards (`publicGame` in `src/lib/server/room.ts`).
- Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (≤ every 10 s);
  re-joining with an existing nickname reclaims that seat (new token) from the same device (`device_hash`) or once
  the seat has been unseen for 45 s, also mid-game. `/state` exposes only a derived `connected` flag.
- Realtime: Broadcast topic `whist:room:<uuid>` carries no data, clients re-fetch `/state`; 15 s polling fallback.

## Testing
- `npm test` (Vitest, `src/lib/whist.test.ts` incl. a full random game), `npx tsc --noEmit`, `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 3 and 4 players (create, join, settings, start, bid, play a whole hand,
  leave mid-game, kick, new-round) against `npm run dev`. Delete the test rooms afterwards.
