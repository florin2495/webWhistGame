import "server-only";
import { kickRemainingMs } from "@/lib/kick";
import { isConnected, LAST_SEEN_TOUCH_MS } from "@/lib/reconnect";
import type { PublicGame, PublicPlayer, RoomState } from "@/lib/types";
import {
  allowedBids,
  dealerSeat,
  DEFAULT_SETTINGS,
  isRoomAbandoned,
  isRoomExpired,
  leaders,
  legalCards,
  minutesLabel,
  PLAYING_IDLE_MINUTES,
  ROOM_ABANDONED_MS,
  ROOM_IDLE_MINUTES,
  type Sequence,
  SEQUENCES,
  type Settings,
  sortHand,
  trumpOf,
} from "@/lib/whist";
import { hashToken } from "./crypto";
import { db, PLAYER_COLUMNS, type PlayerRow, ROOM_COLUMNS, type RoomRow, type StoredGame, T } from "./db";
import { fail } from "./http";
import { enforceExpiredKicks } from "./membership";

const GONE = `Camera nu există sau a fost închisă după ${minutesLabel(ROOM_IDLE_MINUTES)} de inactivitate.`;

export function normalizeCode(code: string): string {
  const c = decodeURIComponent(code).trim().toUpperCase();
  if (!/^[A-Z2-9]{6}$/.test(c)) fail(404, GONE);
  return c;
}

export async function getRoomByCode(code: string): Promise<RoomRow> {
  const { data, error } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  if (!data) fail(404, GONE);
  const room = data as RoomRow;
  // Lazy expiry: Vercel Hobby has no frequent cron, so idle rooms are closed when touched.
  if (isRoomExpired(room.status, room.last_activity_at)) {
    await db().from(T.rooms).delete().eq("id", room.id).eq("last_activity_at", room.last_activity_at);
    fail(404, GONE);
  }
  return room;
}

/** Deletes every idle room (10 min for lobby/finished, 60 min for a game nobody has open). */
export async function cleanupExpiredRooms(): Promise<void> {
  const now = Date.now();
  const short = new Date(now - ROOM_IDLE_MINUTES * 60_000).toISOString();
  const long = new Date(now - PLAYING_IDLE_MINUTES * 60_000).toISOString();
  const a = await db().from(T.rooms).delete().in("status", ["lobby", "finished"]).lt("last_activity_at", short);
  if (a.error) console.error("cleanup failed", a.error);
  const b = await db().from(T.rooms).delete().eq("status", "playing").lt("last_activity_at", long);
  if (b.error) console.error("cleanup failed", b.error);
}

/**
 * Deletes rooms in ANY status (also "playing") with no activity for ROOM_ABANDONED_MS and no member
 * (player or spectator, both are whist_players rows) seen within it (see isRoomAbandoned). Members
 * cascade on delete. Best effort: a failure is logged, never thrown.
 */
export async function cleanupAbandonedRooms(): Promise<void> {
  try {
    const now = Date.now();
    const cutoff = new Date(now - ROOM_ABANDONED_MS).toISOString();
    const { data, error } = await db()
      .from(T.rooms)
      .select("id, last_activity_at, members:whist_players!whist_players_room_id_fkey(last_seen_at)")
      .lt("last_activity_at", cutoff)
      .limit(200);
    if (error) {
      console.error("abandoned cleanup (select) failed", error);
      return;
    }
    type Seen = { last_seen_at: string | null }[] | null;
    const ids = (data ?? [])
      .filter((r) => {
        const seen = ((r.members as unknown as Seen) ?? []).map((m) => m.last_seen_at);
        return isRoomAbandoned(r.last_activity_at as string, seen, now);
      })
      .map((r) => r.id as string);
    if (ids.length === 0) return;
    // Re-check the activity cutoff in the delete itself, so a room touched meanwhile survives.
    const { error: delError } = await db().from(T.rooms).delete().in("id", ids).lt("last_activity_at", cutoff);
    if (delError) console.error("abandoned cleanup (delete) failed", delError);
  } catch (err) {
    console.error("abandoned cleanup failed", err);
  }
}

/** Records activity on a room, restarting its idle timer. */
export async function touchRoom(roomId: string): Promise<void> {
  const { error } = await db().from(T.rooms).update({ last_activity_at: new Date().toISOString() }).eq("id", roomId);
  if (error) throw error;
}

/** Re-reads a room by id; null when it no longer exists (e.g. the last player was removed). */
export async function reloadRoom(roomId: string): Promise<RoomRow | null> {
  const { data, error } = await db().from(T.rooms).select(ROOM_COLUMNS).eq("id", roomId).maybeSingle();
  if (error) throw error;
  return (data as RoomRow | null) ?? null;
}

/** Cancels every pending kick in the room (new game, back to the lobby, game over). */
export async function clearKicks(roomId: string): Promise<void> {
  const { error } = await db().from(T.players).update({ kick_requested_at: null }).eq("room_id", roomId).not("kick_requested_at", "is", null);
  if (error) throw error;
}

/** Resolves the caller from the x-player-token header and checks they belong to the room. */
export async function requireMember(req: Request, code: string): Promise<{ room: RoomRow; player: PlayerRow }> {
  const token = req.headers.get("x-player-token");
  if (!token || token.length > 200) fail(401, "Nu ești în această cameră.");
  let room = await getRoomByCode(code);
  // Lazy enforcement of expired pending kicks (no timers on serverless). Runs before the caller's
  // membership lookup, so a player who was just removed gets the usual 401 below.
  const after = await enforceExpiredKicks(room);
  if (!after) fail(404, GONE);
  room = after;
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("token_hash", hashToken(token))
    .eq("room_id", room.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) fail(401, "Nu ești în această cameră.");
  const player = data as PlayerRow;
  await touchPlayer(player);
  return { room, player };
}

/** Presence heartbeat: stamps last_seen_at at most every LAST_SEEN_TOUCH_MS. Best effort, never throws. */
async function touchPlayer(player: PlayerRow): Promise<void> {
  const now = Date.now();
  if (now - Date.parse(player.last_seen_at) < LAST_SEEN_TOUCH_MS) return;
  player.last_seen_at = new Date(now).toISOString();
  const { error } = await db().from(T.players).update({ last_seen_at: player.last_seen_at }).eq("id", player.id);
  if (error) console.error("presence touch failed", error);
}

export function requireHost(room: RoomRow, player: PlayerRow) {
  if (room.host_player_id !== player.id) fail(403, "Doar creatorul camerei poate face asta.");
}

export function requireStatus(room: RoomRow, ...allowed: RoomRow["status"][]) {
  if (!allowed.includes(room.status)) {
    const msg: Record<RoomRow["status"], string> = {
      lobby: "Jocul nu a început încă.",
      playing: "Jocul este în desfășurare.",
      finished: "Jocul s-a terminat.",
    };
    fail(409, msg[room.status]);
  }
}

/** Everyone in the room (players and spectators). Players come in play order (seat, then join order). */
export async function listMembers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", roomId)
    .order("seat", { ascending: true, nullsFirst: false })
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

/** The players only (not spectators), in play order. */
export async function listPlayers(roomId: string): Promise<PlayerRow[]> {
  return (await listMembers(roomId)).filter((p) => p.role === "player");
}

/** Spectators in queue order: queued ones first (by queued_at), then the others by join time. */
export function sortSpectators(rows: PlayerRow[]): PlayerRow[] {
  const spectators = rows.filter((p) => p.role === "spectator");
  const q = (p: PlayerRow) => (p.queued_at ? Date.parse(p.queued_at) : Infinity);
  return [...spectators].sort((a, b) => q(a) - q(b) || Date.parse(a.joined_at) - Date.parse(b.joined_at));
}

/**
 * Writes the room only if nobody else changed it since we read it (optimistic lock on
 * `version`). Two moves at the same time: one wins, the other gets a 409 and retries.
 */
export async function saveRoom(room: RoomRow, update: Partial<Omit<RoomRow, "id" | "version">>): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db()
    .from(T.rooms)
    .update({ ...update, version: room.version + 1, updated_at: now, last_activity_at: now })
    .eq("id", room.id)
    .eq("version", room.version)
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) fail(409, "Altcineva a mutat între timp. Mai încearcă o dată.");
}

/** Validates settings sent by the host; missing fields keep `current`. */
export function parseSettings(body: Record<string, unknown>, current: Settings = DEFAULT_SETTINGS): Settings {
  const sequence = body.sequence === undefined ? current.sequence : body.sequence;
  if (!SEQUENCES.includes(sequence as Sequence)) fail(400, "Varianta trebuie să fie 1-8-1 sau 8-1-8.");
  const flag = (v: unknown, fallback: boolean, name: string) => {
    if (v === undefined) return fallback;
    if (typeof v !== "boolean") fail(400, `${name}: valoare invalidă.`);
    return v;
  };
  return {
    sequence: sequence as Sequence,
    bonus: flag(body.bonus, current.bonus, "Bonus"),
    mustTrump: flag(body.mustTrump, current.mustTrump, "Tăiere obligatorie"),
  };
}

const toPublic = (p: PlayerRow, now: number): PublicPlayer => ({
  id: p.id,
  nickname: p.nickname,
  isHost: p.is_host,
  role: p.role,
  queued: p.queued_at !== null,
  kickRemainingMs: kickRemainingMs(p.kick_requested_at, now),
  connected: isConnected(p.last_seen_at, now),
});

export function publicGame(g: StoredGame, meId: string): PublicGame {
  const seat = g.seats.indexOf(meId);
  const mySeat = seat >= 0 ? seat : null;
  const myTurn = mySeat !== null && g.turn === mySeat;
  return {
    names: g.names,
    seats: g.seats,
    mySeat,
    sizes: g.sizes,
    handIndex: g.handIndex,
    handSize: g.sizes[g.handIndex],
    phase: g.phase,
    trumpCard: g.trumpCard,
    trump: trumpOf(g),
    dealer: dealerSeat(g.handIndex, g.seats.length),
    bids: g.bids,
    tricks: g.tricks,
    turn: g.turn,
    trick: g.trick,
    lastTrick: g.lastTrick,
    scores: g.scores,
    streaks: g.streaks,
    history: g.history,
    cardsLeft: g.hands.map((h) => h.length),
    myHand: mySeat !== null ? sortHand(g.hands[mySeat] ?? [], trumpOf(g)) : [],
    legal: myTurn && g.phase === "playing" ? legalCards(g, mySeat) : [],
    allowedBids: myTurn && g.phase === "bidding" ? allowedBids(g, mySeat) : [],
    abortedBy: g.abortedBy,
    winners: g.phase === "over" && !g.abortedBy ? leaders(g.scores) : [],
  };
}

export async function buildState(room: RoomRow, me: PlayerRow): Promise<RoomState> {
  const now = Date.now();
  const members = await listMembers(room.id);
  const players = members.filter((p) => p.role === "player");
  const spectators = sortSpectators(members);
  let ordered = players;
  if (room.game) {
    const pos = new Map(room.game.seats.map((id, i) => [id, i]));
    ordered = [...players].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  return {
    room: {
      id: room.id,
      code: room.code,
      name: room.name,
      status: room.status,
      round: room.round,
      hasPassword: room.password_hash !== null,
      hostPlayerId: room.host_player_id,
      settings: room.settings,
    },
    players: ordered.map((p) => toPublic(p, now)),
    spectators: spectators.map((p) => toPublic(p, now)),
    me: toPublic(me, now),
    game: room.game ? publicGame(room.game, me.id) : null,
  };
}
