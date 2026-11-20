// End-to-end test of the Whist API with real players. Usage: node scripts/e2e.mjs [baseUrl incl. /whist]
// HTTP checks (page, assets, version, manifest, icons), then a whole 3-player game (1-8-1) with spectators, reorder and
// every rule check, then a 5-player game that is stopped by an enforced kick.
// Rooms are named "e2e-test-…" and nicknames start with "e2e" (test rooms are never reported to the hub leaderboard).
// At the end it deletes its rooms (leave as every player, then a DB delete of leftovers) and its leaderboard rows,
// with the service key: env NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, else .env.local. Never sends feedback.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/whist").replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const BASE_PATH = new URL(BASE).pathname;
const VERCEL = "https://web-whist-game.vercel.app" + BASE_PATH;
const created = new Set(); // rooms still to delete
const used = new Set(); // every room code of this run (leaderboard cleanup)
let failures = 0;

// Nicknames (max 10 chars). The "e2e" prefix lets the cleanup find their leaderboard rows.
const N = { A: "e2eAna", B: "e2eBob", C: "e2eCris", D: "e2eDan", E: "e2eEma", F: "e2eFan", G: "e2eGil", S: "e2eSpe", V: "e2eViz" };

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + path, { method: method ?? (body !== undefined ? "POST" : "GET"), headers, body: body !== undefined ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data, region: res.headers.get("x-vercel-id") };
    } catch (err) {
      if (attempt >= 2) throw err; // network blip: retry twice
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (code, p) => {
  const r = await call(`/api/rooms/${code}/state`, { token: p.token });
  if (r.status !== 200) throw new Error(`state ${p.name}: ${r.status} ${r.data.error}`);
  return r.data;
};

// Minimal copy of the rules needed to check the server (src/lib/whist.ts).
const suitOf = (c) => c[0];
const handPoints = (bid, tricks) => (bid === tricks ? 5 + bid : -Math.abs(bid - tricks));

/** Hands of every seat are disjoint, each player sees only their own cards, shared fields agree. */
function consistent(states) {
  const all = states.flatMap((s) => s.game.myHand);
  const disjoint = new Set(all).size === all.length;
  const sizes = states.every((s) => s.game.mySeat === null || s.game.myHand.length === s.game.cardsLeft[s.game.mySeat]);
  const json = states.map((s) => JSON.stringify(s));
  const noHands = json.every((j) => !j.includes('"hands"') && !j.includes("token") && !j.includes("device"));
  const shared = (f) => states.every((s) => JSON.stringify(f(s)) === JSON.stringify(f(states[0])));
  return disjoint && sizes && noHands && shared((s) => [s.game.turn, s.game.trick, s.game.bids, s.game.tricks, s.game.scores, s.game.trumpCard, s.game.handIndex]);
}

/**
 * Plays until the game is over (or `stopAfterHands` hands are done). The move response carries the mover's view of
 * the game (turn, phase, room status), so each move costs one /state (the next player's hand) plus the move itself.
 */
async function playGame(code, players, { stopAfterHands = Infinity, checkEvery = 25 } = {}) {
  let s = await state(code, players[0]);
  const bySeat = {};
  for (const p of players) bySeat[s.game.seats.indexOf(p.playerId)] = p;
  let g = s.game;
  let status = s.room.status;
  let moves = 0;
  let checked = 0;
  let consistentOk = true;
  let legalOk = true;
  while (status === "playing" && g.history.length < stopAfterHands && moves < 2000) {
    const p = bySeat[g.turn];
    const mine = (await state(code, p)).game;
    let res;
    if (mine.phase === "bidding") {
      // Bid what we "expect": the number of trumps and aces, kept legal.
      const guess = mine.myHand.filter((c) => c.endsWith("14") || (mine.trump && suitOf(c) === mine.trump)).length;
      const bid = mine.allowedBids.includes(guess) ? guess : mine.allowedBids.reduce((a, b) => (Math.abs(b - guess) < Math.abs(a - guess) ? b : a));
      res = await call(`/api/rooms/${code}/bid`, { token: p.token, body: { bid } });
    } else {
      // legal must be a subset of the hand and follow suit when possible
      const led = mine.trick[0] ? suitOf(mine.trick[0].card) : null;
      const canFollow = led && mine.myHand.some((c) => suitOf(c) === led);
      if (!mine.legal.length || !mine.legal.every((c) => mine.myHand.includes(c)) || (canFollow && !mine.legal.every((c) => suitOf(c) === led))) legalOk = false;
      res = await call(`/api/rooms/${code}/play`, { token: p.token, body: { card: mine.legal[Math.floor(Math.random() * mine.legal.length)] } });
    }
    if (res.status !== 200) {
      check(false, `move by ${p.name} failed: ${res.status} ${res.data.error}`);
      break;
    }
    moves++;
    g = res.data.game;
    status = res.data.status;
    if (moves - checked >= checkEvery && status === "playing") {
      checked = moves;
      if (!consistent(await Promise.all(players.map((x) => state(code, x))))) consistentOk = false;
    }
  }
  check(consistentOk, "players agree on the table and see only their own cards (sampled)");
  check(legalOk, "legal cards always follow suit when possible");
  return { s: await state(code, players[0]), moves };
}

/** Recomputes the score sheet from the history: dealer rule, tricks per hand, points, bonus, totals. */
function verifyHistory(g, bonusOn) {
  const n = g.seats.length;
  const totals = Array(n).fill(0);
  const streaks = Array(n).fill(0);
  const why = [];
  const bad = (msg) => why.push(msg);
  g.history.forEach((h, i) => {
    if (h.handSize !== g.sizes[i]) bad(`size ${i}`);
    if (h.bids.reduce((a, b) => a + b, 0) === h.handSize) bad(`dealer rule ${i}`);
    if (h.tricks.reduce((a, b) => a + b, 0) !== h.handSize) bad(`tricks ${i}`);
    if ((h.handSize === 8) !== (h.trump === null)) bad(`trump ${i}`);
    if (h.dealer !== (i + n - 1) % n) bad(`dealer ${i}`);
    for (let k = 0; k < n; k++) {
      const exact = h.bids[k] === h.tricks[k];
      let st = exact ? (streaks[k] > 0 ? streaks[k] + 1 : 1) : streaks[k] < 0 ? streaks[k] - 1 : -1;
      let bonus = 0;
      if (bonusOn && Math.abs(st) >= 5) {
        bonus = st > 0 ? 10 : -10;
        st = 0;
      }
      streaks[k] = st;
      const pts = handPoints(h.bids[k], h.tricks[k]) + bonus;
      totals[k] += pts;
      if (h.points[k] !== pts || h.bonus[k] !== bonus || h.totals[k] !== totals[k]) bad(`points ${i}/${k}`);
    }
  });
  if (JSON.stringify(totals) !== JSON.stringify(g.scores)) bad("final scores");
  // House rule: exactly 0 points wins (all on 0); with nobody on 0, the highest score wins.
  const zero = totals.flatMap((t, i) => (t === 0 ? [i] : []));
  const top = Math.max(...totals);
  const winners = zero.length > 0 ? zero : totals.flatMap((t, i) => (t === top ? [i] : []));
  if (JSON.stringify(winners) !== JSON.stringify(g.winners)) bad("winners");
  return { ok: why.length === 0, why: why.slice(0, 5).join(", ") };
}

async function httpChecks() {
  console.log("HTTP (pages, assets, version, PWA)");
  const page = await fetch(BASE);
  const html = await page.text();
  check(page.status === 200 && html.includes("Whist"), `GET ${BASE_PATH} = ${page.status}`);
  // The settings panel (with the version) is only on the room page: collect the chunks of both pages.
  const room = await fetch(`${BASE}/room/ABCDEF`);
  const roomHtml = await room.text();
  check(room.status === 200, `GET ${BASE_PATH}/room/ABCDEF = ${room.status} (client shows the join form)`);
  const assets = [...new Set((html + roomHtml).match(new RegExp(`${BASE_PATH}/_next/static/[^"'\\\\\\s]+\\.(?:js|css)`, "g")) ?? [])];
  check(assets.length > 0, `${assets.length} /_next assets referenced under the base path`);
  const assetStatus = await Promise.all(assets.map(async (a) => (await fetch(ORIGIN + a)).status));
  check(assetStatus.every((x) => x === 200), `all /_next assets 200 (${assetStatus.filter((x) => x !== 200).length} failed)`);
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of assets.filter((x) => x.endsWith(".js"))) if ((await (await fetch(ORIGIN + a)).text()).includes(`"${version}"`)) hasVersion = true;
  check(hasVersion, `client JS contains version ${version}`);

  const man = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await man.json().catch(() => null);
  check(man.status === 200 && manifest?.start_url === `${BASE_PATH}/`, `manifest 200, start_url ${manifest?.start_url}`);
  const icons = [...(manifest?.icons ?? []).map((i) => i.src), `${BASE_PATH}/icons/touch-icon-180.png`, `${BASE_PATH}/favicon.ico`];
  for (const src of icons) {
    const r = await fetch(ORIGIN + src);
    const type = r.headers.get("content-type") ?? "";
    check(r.status === 200 && /image\//.test(type), `icon ${src} = ${r.status} ${type}`);
  }

  const v = await fetch(VERCEL);
  const vHtml = await v.text();
  const title = (h) => h.match(/<title>([^<]*)<\/title>/)?.[1];
  check(v.status === 200 && title(vHtml) === title(html), `${VERCEL} = ${v.status}, same page (title ${title(vHtml)})`);
  const chunk = (h) => (h.match(/_next\/static\/[^"']+\.js/g) ?? []).sort().join();
  check(chunk(vHtml) === chunk(html), "vercel.app serves the same build (same chunks)");
}

async function main() {
  console.log(`E2E against ${BASE}`);
  await httpChecks();

  console.log("Room, join, settings");
  const stamp = Date.now().toString(36);
  const r = await call("/api/rooms", { body: { name: `e2e-test-${stamp}`, nickname: N.A, password: "pw", deviceId: randomUUID() } });
  check(r.status === 200 && /^[A-Z2-9]{6}$/.test(r.data.code ?? ""), `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  if (!code) throw new Error(`cannot create a room: ${r.status} ${JSON.stringify(r.data)}`);
  created.add(code);
  used.add(code);
  const A = { ...r.data, name: N.A };
  const devices = {};
  const join = async (nickname, extra = {}) => {
    devices[nickname] ??= randomUUID();
    const res = await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId: devices[nickname], ...extra } });
    return { ...res.data, name: nickname, status: res.status };
  };
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: N.B, password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: N.B } })).status === 403, "missing password = 403");
  // Someone else grabs the nickname first (another device); the real Bob is then refused while that seat is live.
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: N.B, password: "pw", deviceId: randomUUID() } })).status === 200, "join with password");
  const B0 = await join(N.B);
  check(B0.status === 409, `same nickname from another device while connected = 409 (${B0.status})`);
  const ghost = (await state(code, A)).players.find((p) => p.nickname === N.B);
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: ghost.id } })).status === 200, "host kicks in the lobby = immediate");
  const B = await join(N.B);
  const C = await join(N.C);
  const D = await join(N.D);
  check(B.status === 200 && C.status === 200 && D.status === 200 && B.role === "player", "3 more players joined");
  const E = await join(N.E);
  const F = await join(N.F);
  check(E.role === "player" && F.role === "player", "6 players (the maximum)");
  const G = await join(N.G);
  check(G.status === 200 && G.role === "spectator", `7th joiner of a full lobby = spectator (${G.status} ${G.role})`);
  let sl = await state(code, A);
  check(sl.players.length === 6 && sl.spectators.length === 1 && sl.spectators[0].nickname === N.G, "lobby: 6 players + 1 spectator");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "x".repeat(11), password: "pw" } })).status === 400, "nickname > 10 chars = 400");
  const list = await call("/api/rooms");
  const item = list.data.rooms?.find((x) => x.code === code);
  check(item?.hasPassword === true && item.players === 6 && item.status === "lobby" && !("password_hash" in item), "room in the public list: password flag, 6 players (spectators not counted), no hash");
  check((await call(`/api/rooms/${code}/leave`, { token: G.token, body: {} })).status === 200, "spectator leaves");
  for (const p of [E, F]) check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: p.playerId } })).status === 200, `host kicks ${p.name} (lobby)`);
  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { sequence: "8-1-8" } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { sequence: "2-3-2" } })).status === 400, "bad sequence = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { sequence: "1-8-1", bonus: true, mustTrump: true } })).status === 200, "host saves settings");
  check((await call(`/api/rooms/${code}/state`, { token: "bogus" })).status === 401, "bad token = 401");
  check((await call(`/api/rooms/${code}/state`)).status === 401, "no token = 401");
  check((await call(`/api/rooms/ZZZZZZ/state`, { token: A.token })).status === 404, "unknown room = 404");

  console.log("Rejoin with the saved device");
  const B2 = await join(N.B);
  check(B2.status === 200 && B2.playerId === B.playerId && B2.token !== B.token, "same device reclaims the same seat with a new token");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token no longer works");
  Object.assign(B, B2);

  console.log("Kick Dan, reorder, start with 3");
  check((await call(`/api/rooms/${code}/kick`, { token: B.token, body: { playerId: D.playerId } })).status === 403, "non-host kick = 403");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: A.playerId } })).status === 400, "host kicks self = 400");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: "not-a-uuid" } })).status === 404, "kick unknown id = 404");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: D.playerId } })).status === 200, "host kicks Dan");
  check((await call(`/api/rooms/${code}/state`, { token: D.token })).status === 401, "kicked player gets 401");
  const order = [C.playerId, B.playerId, A.playerId];
  check((await call(`/api/rooms/${code}/reorder`, { token: B.token, body: { order } })).status === 403, "non-host reorder = 403");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order: order.slice(1) } })).status === 400, "reorder missing a player = 400");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order } })).status === 200, "host reorders (reverse)");
  sl = await state(code, B);
  check(JSON.stringify(sl.players.map((p) => p.id)) === JSON.stringify(order), "everyone sees the new order");
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 403, "non-host start = 403");
  check((await call(`/api/rooms/${code}/bid`, { token: A.token, body: { bid: 0 } })).status === 409, "bid in the lobby = 409");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "host starts (3 players)");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "double start = 409");
  check((await call(`/api/rooms/${code}/reorder`, { token: A.token, body: { order } })).status === 409, "reorder mid-game = 409");
  const listed = (await call("/api/rooms")).data.rooms?.find((x) => x.code === code);
  check(listed?.status === "playing", `running room in the public list as "playing" (${listed?.status})`);

  console.log("First hand: rules enforced");
  const P = [A, B, C];
  let ss = await Promise.all(P.map((p) => state(code, p)));
  const g0 = ss[0].game;
  check(JSON.stringify(g0.seats) === JSON.stringify(order), "seats follow the host's order");
  check(g0.phase === "bidding" && g0.handSize === 1 && g0.trumpCard !== null && g0.seats.length === 3, "hand of 1 with a trump card, bidding");
  check(consistent(ss) && ss.every((s) => s.game.myHand.length === 1), "each player sees exactly their own 1 card");
  const bySeat = (seat) => P.find((p) => p.playerId === g0.seats[seat]);
  const first = bySeat(g0.turn);
  const second = bySeat((g0.turn + 1) % 3);
  const dealer = bySeat(g0.dealer);
  check(first === C, "the first in the host's order bids first");
  check((await call(`/api/rooms/${code}/bid`, { token: second.token, body: { bid: 0 } })).status === 409, "bid out of turn = 409");
  check((await call(`/api/rooms/${code}/bid`, { token: first.token, body: { bid: 5 } })).status === 409, "bid > hand size = 409");
  check((await call(`/api/rooms/${code}/bid`, { token: first.token, body: { bid: "x" } })).status === 400, "non-number bid = 400");
  const fCard = ss[P.indexOf(first)].game.myHand[0];
  check((await call(`/api/rooms/${code}/play`, { token: first.token, body: { card: fCard } })).status === 409, "play during bidding = 409");
  check((await call(`/api/rooms/${code}/bid`, { token: first.token, body: { bid: 1 } })).status === 200, "first bids 1");
  check((await call(`/api/rooms/${code}/bid`, { token: second.token, body: { bid: 0 } })).status === 200, "second bids 0");
  check((await call(`/api/rooms/${code}/bid`, { token: dealer.token, body: { bid: 0 } })).status === 409, "dealer bid making the total equal = 409");
  const ds = await state(code, dealer);
  check(JSON.stringify(ds.game.allowedBids) === "[1]", "dealer allowed bids exclude the forbidden one");
  check((await call(`/api/rooms/${code}/bid`, { token: dealer.token, body: { bid: 1 } })).status === 200, "dealer bids 1");
  ss = await Promise.all(P.map((p) => state(code, p)));
  check(ss[0].game.phase === "playing" && ss[0].game.turn === g0.turn, "playing, first bidder leads");
  check((await call(`/api/rooms/${code}/play`, { token: second.token, body: { card: ss[P.indexOf(second)].game.myHand[0] } })).status === 409, "play out of turn = 409");
  const notMine = ss[P.indexOf(second)].game.myHand[0];
  check((await call(`/api/rooms/${code}/play`, { token: first.token, body: { card: notMine } })).status === 409, "play a card you do not hold = 409");
  check((await call(`/api/rooms/${code}/play`, { token: first.token, body: { card: "Z99" } })).status === 400, "malformed card = 400");

  console.log("Spectators join the running game");
  const S = await join(N.S);
  check(S.status === 200 && S.role === "spectator", `newcomer mid-game = spectator (${S.status} ${S.role})`);
  const sv = await state(code, S);
  check(sv.me.role === "spectator" && sv.game.mySeat === null && sv.game.myHand.length === 0 && sv.game.legal.length === 0, "spectator: no seat, no cards");
  check(!JSON.stringify(sv).includes('"hands"') && sv.game.trumpCard === g0.trumpCard, "spectator sees the table, never the hands");
  check((await call(`/api/rooms/${code}/bid`, { token: S.token, body: { bid: 0 } })).status === 403, "spectator bid = 403");
  check((await call(`/api/rooms/${code}/play`, { token: S.token, body: { card: fCard } })).status === 403, "spectator play = 403");
  check((await call(`/api/rooms/${code}/start`, { token: S.token, body: {} })).status === 403, "spectator start = 403");
  check((await call(`/api/rooms/${code}/queue`, { token: A.token, body: {} })).status === 409, "a player cannot queue = 409");
  const q = await call(`/api/rooms/${code}/queue`, { token: S.token, body: {} });
  check(q.status === 200 && q.data.queued === true, "spectator queues for the next game");
  sl = await state(code, A);
  check(sl.spectators.length === 1 && sl.spectators[0].queued === true && sl.players.length === 3, "players see the queued spectator");
  const S2 = await join(N.S);
  check(S2.status === 200 && S2.playerId === S.playerId && S2.role === "spectator", "spectator rejoins from the same device: same id, still a spectator");
  Object.assign(S, S2);
  check((await state(code, S)).me.queued === true, "still queued after the rejoin");
  const V = await join(N.V);
  check(V.role === "spectator", "a second spectator joins");
  const kv = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: V.playerId } });
  check(kv.status === 200 && !kv.data.pending, "kicking a spectator mid-game is immediate");
  check((await call(`/api/rooms/${code}/state`, { token: V.token })).status === 401, "kicked spectator = 401");

  console.log("Mid-game: pending kick, Ignoră, rejoin");
  const kick = await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: C.playerId } });
  check(kick.status === 200 && kick.data.pending === true, "kick in game is pending");
  check((await state(code, C)).me.kickRemainingMs > 0, "kicked player sees the countdown");
  check((await call(`/api/rooms/${code}/kick/ignore`, { token: C.token, body: {} })).status === 200, "Ignoră");
  check((await state(code, C)).me.kickRemainingMs === null, "kick cleared");
  const C2 = await join(N.C);
  check(C2.status === 200 && C2.playerId === C.playerId, "rejoin mid-game keeps the seat");
  Object.assign(C, C2);
  check((await state(code, C)).game.myHand.length === 1, "rejoined player gets their hand back");

  console.log("Concurrent double play");
  const lead = bySeat((await state(code, A)).game.turn);
  const ls = await state(code, lead);
  const dbl = await Promise.all([0, 1].map(() => call(`/api/rooms/${code}/play`, { token: lead.token, body: { card: ls.game.legal[0] } })));
  check(dbl.filter((x) => x.status === 200).length === 1, `same card twice at once: one accepted (${dbl.map((x) => x.status)})`);
  const after = await state(code, A);
  check(after.game.trick.length === 1, "only one card on the table");
  check((await state(code, S)).game.trick.length === 1, "the spectator sees the card on the table");

  console.log("Play the whole game");
  const t0 = Date.now();
  const { s, moves } = await playGame(code, P);
  check(s.room.status === "finished" && s.game.phase === "over", `game over after ${moves} more moves (${Math.round((Date.now() - t0) / 1000)} s)`);
  check(s.game.history.length === 21 && s.game.abortedBy === null, "21 hands played (3 players, 1-8-1)");
  const v = verifyHistory(s.game, true);
  check(v.ok, `score sheet, dealer rule, bonus and winner recomputed ${v.why}`);
  check(s.game.myHand.length === 0 && s.game.cardsLeft.every((x) => x === 0), "no cards left");
  check((await call(`/api/rooms/${code}/play`, { token: A.token, body: { card: "H14" } })).status === 409, "move after the game = 409");
  const sb = supabase();
  if (sb) {
    const rounds = await sbGet(sb, `hub_leaderboard_rounds?game=eq.whist&room_code=eq.${code}&select=round_no`);
    check(Array.isArray(rounds) && rounds.length === 0, "finished e2e-test room NOT reported to the hub leaderboard");
  } else console.log("  - leaderboard check skipped (no Supabase env)");

  console.log("New round: queued spectator promoted, 5 players");
  check((await call(`/api/rooms/${code}/new-round`, { token: B.token, body: {} })).status === 403, "non-host new round = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 200, "host new round");
  let s2 = await state(code, S);
  check(s2.me.role === "player" && s2.spectators.length === 0 && s2.players.length === 4, "the queued spectator is now a player");
  const rotated = [...s.game.seats.slice(1), s.game.seats[0], S.playerId];
  check(JSON.stringify(s2.players.map((p) => p.id)) === JSON.stringify(rotated), "order rotated by one, promoted spectator last");
  const D2 = await join(N.D);
  check(D2.status === 200 && D2.role === "player", "Dan joins the lobby again as a player");
  Object.assign(D, D2);
  s2 = await state(code, D);
  check(s2.room.status === "lobby" && s2.room.round === 2 && s2.game === null && s2.players.length === 5, "lobby, round 2, 5 players");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { sequence: "8-1-8", bonus: false, mustTrump: false } })).status === 200, "8-1-8 without bonus");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "start with 5");
  const P5 = [A, B, C, S, D];
  const ss5 = await Promise.all(P5.map((p) => state(code, p)));
  const g5 = ss5[0].game;
  check(g5.handSize === 8 && g5.trumpCard === null && g5.sizes.length === 27 && consistent(ss5), "5 players: 27 hands, 8-card hand without trump, 40 cards split");
  check(ss5.every((x) => x.game.myHand.every((c) => Number(c.slice(1)) >= 5)), "5 players: deck from 5 to A");
  check(g5.seats[0] !== s.game.seats[0], "a different player opens game 2");
  const r2 = await playGame(code, P5, { stopAfterHands: 2, checkEvery: 10 });
  check(r2.s.game.history.length === 2, "2 hands played with 5 players");

  console.log("Kick enforced after 12 s stops the game");
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: D.playerId } })).data.pending === true, "kick Dan (pending)");
  await sleep(12_500);
  check((await call(`/api/rooms/${code}/state`, { token: D.token })).status === 401, "kick enforced");
  s2 = await state(code, A);
  check(s2.room.status === "finished" && s2.game.abortedBy === N.D && s2.game.winners.length === 0, "game stopped, no winner");

  console.log("Host leaves: host passes on");
  const nextHost = P5.find((p) => p.playerId === s2.players.find((x) => x.id !== A.playerId).id);
  check((await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} })).status === 200, "Ana leaves");
  s2 = await state(code, nextHost);
  check(s2.room.hostPlayerId === nextHost.playerId && s2.players.find((p) => p.id === nextHost.playerId).isHost, `${nextHost.name} (next in play order) is the new host`);
  check((await call(`/api/rooms/${code}/new-round`, { token: nextHost.token, body: {} })).status === 200, "new host can start a new round");

  console.log("Feedback validation (nothing stored)");
  check((await call("/api/feedback", { body: { message: "" } })).status === 400, "empty feedback = 400");

  console.log("Cleanup");
  const rest = [B, C, S].filter((p) => p !== nextHost);
  for (const p of rest) await call(`/api/rooms/${code}/leave`, { token: p.token, body: {} });
  const last = await call(`/api/rooms/${code}/leave`, { token: nextHost.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);
}

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
const sbGet = async (sb, path) => (await fetch(`${sb.url}/${path}`, { headers: sb.headers })).json();

/**
 * Safety net: delete rooms left behind by a failed run, then the leaderboard rows this run wrote (round rows of its
 * room codes, player rows of the "e2e" nicknames), straight in the DB.
 */
async function cleanup() {
  const sb = supabase();
  if (!sb) {
    if (created.size) console.log("  cleanup: no Supabase env, delete these rooms by hand:", [...created].join(", "));
    return;
  }
  try {
    if (created.size) {
      const res = await fetch(`${sb.url}/whist_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`, { method: "DELETE", headers: sb.headers });
      console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
    }
    if (used.size) {
      const rr = await fetch(`${sb.url}/hub_leaderboard_rounds?game=eq.whist&room_code=in.(${[...used].join(",")})`, { method: "DELETE", headers: sb.headers });
      const lb = await fetch(`${sb.url}/hub_leaderboard?game=eq.whist&player_key=like.e2e*`, { method: "DELETE", headers: sb.headers });
      console.log(`  cleanup: leaderboard test rows deleted (rounds ${rr.status}, players ${lb.status})`);
    }
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
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
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
