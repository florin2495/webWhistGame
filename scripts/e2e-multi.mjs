// E2E for 4-6 players: full lobby -> spectator, host reorder, seats, deck size, late spectator (no private data),
// queue, a few hands (or the whole game), then new-round promoting the queued spectator.
//   node scripts/e2e-multi.mjs [baseUrl incl. /whist] [players 3-6, default 5] [hands to play, default 4, or "all"]
// "all" plays the whole game and checks the hub leaderboard report (slow with 6 players: ~900 moves).
// Otherwise a seated player leaves after the hands (the game stops, nothing is reported to the leaderboard).
// Rooms are named "e2e-test-multi-…", nicknames start with "e2e". At the end the room is closed (everyone leaves) and,
// as a safety net, deleted in the DB together with this run's leaderboard rows (service key: env, else .env.local).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const [baseArg, nArg = "5", handsArg = "4"] = process.argv.slice(2);
const BASE = (baseArg ?? "https://games.hailatat.icu/whist").replace(/\/$/, "");
const n = Number(nArg);
const full = handsArg === "all";
const handsToPlay = full ? Infinity : Number(handsArg);
if (!(n >= 3 && n <= 6) || !(handsToPlay >= 1)) {
  console.error("usage: node scripts/e2e-multi.mjs [baseUrl] [3-6] [hands|all]");
  process.exit(2);
}

let failures = 0;
const check = (c, m) => {
  if (!c) failures++;
  console.log(c ? "  ✓" : "  ✗", m);
};

async function call(path, { token, body } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        method: body !== undefined ? "POST" : "GET",
        headers: { ...(token ? { "x-player-token": token } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    } catch (err) {
      if (attempt >= 2) throw err; // network blip: retry twice
    }
  }
}
const state = async (code, p) => {
  const r = await call(`/api/rooms/${code}/state`, { token: p.token });
  if (r.status !== 200) throw new Error(`state ${p.name}: ${r.status} ${r.data.error}`);
  return r.data;
};

/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local; null if neither. */
function supabase() {
  let { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) {
    try {
      const env = Object.fromEntries(
        readFileSync(new URL("../.env.local", import.meta.url), "utf8")
          .split(/\r?\n/)
          .filter((l) => l.includes("=") && !l.startsWith("#"))
          .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
      );
      url = env.NEXT_PUBLIC_SUPABASE_URL;
      key = env.SUPABASE_SERVICE_ROLE_KEY;
    } catch {
      return null;
    }
  }
  return url && key ? { url: `${url}/rest/v1`, headers: { apikey: key, authorization: `Bearer ${key}` } } : null;
}

const names = ["e2eP1", "e2eP2", "e2eP3", "e2eP4", "e2eP5", "e2eP6", "e2eP7"];
const pw = "pw";
let code = null;
let closed = false;

/** One move by whoever's turn it is (lowest legal bid / first legal card). Returns the move response's game. */
async function step(ps, g) {
  const p = ps.find((x) => x.playerId === g.seats[g.turn]);
  const mine = (await state(code, p)).game;
  const r =
    mine.phase === "bidding"
      ? await call(`/api/rooms/${code}/bid`, { token: p.token, body: { bid: mine.allowedBids[0] } })
      : await call(`/api/rooms/${code}/play`, { token: p.token, body: { card: mine.legal[0] } });
  if (r.status !== 200) throw new Error(`${mine.phase} by ${p.name}: ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

async function main() {
  console.log(`E2E multi: ${n} players, ${full ? "whole game" : `${handsToPlay} hands`}, on ${BASE}`);
  const r = await call("/api/rooms", { body: { name: `e2e-test-multi-${Date.now().toString(36)}`, nickname: names[0], password: pw, deviceId: randomUUID() } });
  code = r.data.code;
  if (!code) throw new Error(`cannot create a room: ${r.status} ${JSON.stringify(r.data)}`);
  const ps = [{ ...r.data, name: names[0] }];
  for (let i = 1; i < n; i++) {
    const j = await call(`/api/rooms/${code}/join`, { body: { nickname: names[i], password: pw, deviceId: randomUUID() } });
    ps.push({ ...j.data, name: names[i], status: j.status });
  }
  const host = ps[0];
  check(ps.every((p) => p.token && (p.role ?? "player") === "player"), `${n} players joined (room ${code})`);
  const watchers = [];

  // A full lobby makes the next one a spectator.
  if (n === 6) {
    const x = await call(`/api/rooms/${code}/join`, { body: { nickname: names[6], password: pw, deviceId: randomUUID() } });
    check(x.status === 200 && x.data.role === "spectator", "7th joiner into a full lobby = spectator, not refused");
    const st = await state(code, host);
    check(st.spectators.length === 1 && st.players.length === 6, "lobby: 6 players + 1 spectator");
    watchers.push({ ...x.data, name: names[6] });
  }

  // Reorder: reverse the lobby order, start, seats must follow exactly.
  const lobby = await state(code, host);
  const rev = [...lobby.players].reverse().map((p) => p.id);
  check((await call(`/api/rooms/${code}/reorder`, { token: ps[1].token, body: { order: rev } })).status === 403, "non-host reorder = 403");
  check((await call(`/api/rooms/${code}/reorder`, { token: host.token, body: { order: rev } })).status === 200, "host reorder = 200");
  const st = await call(`/api/rooms/${code}/start`, { token: host.token, body: {} });
  check(st.status === 200, `start with ${n} players = ${st.status}`);
  const s0 = await state(code, host);
  check(JSON.stringify(s0.game.seats) === JSON.stringify(rev), "seats = reordered list");
  check(s0.game.cardsLeft.length === n && s0.game.cardsLeft.every((c) => c === 1), "first hand: 1 card each");
  check(s0.game.sizes.length === 3 * n + 12, `game has ${3 * n + 12} hands`);
  const lowest = 15 - 8 * n / 4; // 8 cards per player in 4 suits: 3 -> 9, 4 -> 7, 5 -> 5, 6 -> 3
  const hands0 = await Promise.all(ps.map((p) => state(code, p)));
  check(hands0.every((x) => x.game.myHand.every((c) => Number(c.slice(1)) >= lowest)), `deck starts at rank ${lowest}`);

  // Late spectator (private data check) + queue.
  const late = await call(`/api/rooms/${code}/join`, { body: { nickname: "e2eLate", password: pw, deviceId: randomUUID() } });
  const L = { ...late.data, name: "e2eLate" };
  check(late.status === 200 && L.role === "spectator", "joining a running game = spectator");
  const ls = await state(code, L);
  check(ls.game.mySeat === null && ls.game.myHand.length === 0 && !JSON.stringify(ls).includes('"hands"'), "spectator sees no cards");
  check((await call(`/api/rooms/${code}/bid`, { token: L.token, body: { bid: 0 } })).status === 403, "spectator cannot act (403)");
  check((await call(`/api/rooms/${code}/queue`, { token: L.token, body: {} })).data.queued === true, "spectator queues for next round");

  let g = s0.game;
  let status = "playing";
  let moves = 0;
  while (status === "playing" && g.history.length < handsToPlay) {
    const res = await step(ps, g);
    g = res.game;
    status = res.status;
    moves++;
  }
  const mid = await Promise.all([...ps, L].map((p) => state(code, p)));
  const same = mid.every((x) => JSON.stringify([x.game.scores, x.game.handIndex, x.game.turn]) === JSON.stringify([mid[0].game.scores, mid[0].game.handIndex, mid[0].game.turn]));
  check(same, `${moves} moves, everyone (spectator too) sees the same scores and turn`);

  let expectPlayers;
  if (full) {
    const end = mid[0];
    check(end.game.phase === "over" && end.game.history.length === 3 * n + 12, `game over, ${end.game.history.length} hands`);
    expectPlayers = Math.min(n + 1, 6);
    const sb = supabase();
    if (sb) {
      const rounds = await (await fetch(`${sb.url}/hub_leaderboard_rounds?game=eq.whist&room_code=eq.${code}&select=round_no`, { headers: sb.headers })).json();
      check(Array.isArray(rounds) && rounds.length === 1, "game reported to the hub leaderboard once");
      const keys = ps.map((p) => p.name.toLowerCase()).join(",");
      const lb = await (await fetch(`${sb.url}/hub_leaderboard?game=eq.whist&player_key=in.(${keys})&select=player_key,games`, { headers: sb.headers })).json();
      check(Array.isArray(lb) && lb.length === n && lb.every((x) => x.games >= 1), `leaderboard: ${n} player rows`);
    } else console.log("  - leaderboard check skipped (no Supabase env)");
  } else {
    // A seated non-host player leaves: Whist cannot go on with an empty seat, the game stops for everyone.
    const leaver = ps[ps.length - 1];
    check((await call(`/api/rooms/${code}/leave`, { token: leaver.token, body: {} })).status === 200, `${leaver.name} leaves mid-game`);
    ps.pop();
    const stopped = await state(code, L);
    check(stopped.room.status === "finished" && stopped.game.abortedBy === leaver.name && stopped.game.winners.length === 0, "game stopped, no winner (spectator sees it)");
    expectPlayers = n; // n - 1 players + the queued spectator
  }

  const nr = await call(`/api/rooms/${code}/new-round`, { token: host.token, body: {} });
  check(nr.status === 200, "new game");
  const after = await state(code, L);
  const promoted = expectPlayers > (full ? n : n - 1); // a full table (6) has no free seat for the queued spectator
  check(
    after.room.status === "lobby" && after.me.role === (promoted ? "player" : "spectator") && after.players.length === expectPlayers,
    `back to the lobby, ${after.players.length}/${expectPlayers} players, queued spectator ${promoted ? "promoted" : "waits (table full)"}`,
  );
  check(after.spectators.length === watchers.length + (promoted ? 0 : 1), "unqueued spectators stay spectators");

  for (const p of [...watchers, L, ...ps.slice(1)]) await call(`/api/rooms/${code}/leave`, { token: p.token, body: {} });
  const last = await call(`/api/rooms/${code}/leave`, { token: host.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  closed = true;
}

/** Safety net: the room (if still open) and this run's leaderboard rows, straight in the DB. */
async function cleanup() {
  const sb = supabase();
  if (!code) return;
  if (!sb) {
    if (!closed) console.log(`  cleanup: no Supabase env, delete room ${code} by hand`);
    return;
  }
  try {
    if (!closed) {
      const res = await fetch(`${sb.url}/whist_rooms?code=eq.${code}&name=like.e2e-test-*`, { method: "DELETE", headers: sb.headers });
      console.log(`  cleanup: deleted leftover room ${code} (${res.status})`);
    }
    const rr = await fetch(`${sb.url}/hub_leaderboard_rounds?game=eq.whist&room_code=eq.${code}`, { method: "DELETE", headers: sb.headers });
    const lb = await fetch(`${sb.url}/hub_leaderboard?game=eq.whist&player_key=like.e2e*`, { method: "DELETE", headers: sb.headers });
    console.log(`  cleanup: leaderboard test rows deleted (rounds ${rr.status}, players ${lb.status})`);
  } catch (err) {
    console.log(`  cleanup failed, delete room ${code} by hand:`, err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E multi OK" : `\nE2E multi FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
