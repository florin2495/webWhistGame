import { enforceExpiredKicks } from "@/lib/server/membership";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashDeviceId, hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getRoomByCode, touchRoom } from "@/lib/server/room";
import { seatBusyMessage, seatClaim } from "@/lib/reconnect";
import { MAX_SPECTATORS } from "@/lib/spectators";
import { MAX_PLAYERS, NICKNAME_MAX } from "@/lib/whist";

interface SeatRow {
  id: string;
  nickname: string;
  token_hash: string;
  device_hash: string | null;
  last_seen_at: string;
  role: "player" | "spectator";
  seat: number | null;
}

// POST /api/rooms/[code]/join  { nickname, password?, deviceId? }
// A nickname that already has a seat in the room reclaims that seat (same player id, new token) when the
// request comes from the same device or the seat has been disconnected for 45 s - also mid-game.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const deviceHash = hashDeviceId(body.deviceId);
    // Enforce host kicks whose 10 s are over first, so a reclaim cannot undo an expired kick.
    const room = (await enforceExpiredKicks(await getRoomByCode(code))) ?? fail(404, "Camera nu mai există.");

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const { data: seats, error: seatsError } = await db()
      .from(T.players)
      .select("id, nickname, token_hash, device_hash, last_seen_at, role, seat")
      .eq("room_id", room.id);
    if (seatsError) throw seatsError;
    const rows = (seats ?? []) as SeatRow[];

    const existing = rows.find((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      if (seatClaim(existing, deviceHash, Date.now()) === "busy") fail(409, seatBusyMessage(existing.nickname));
      const token = newPlayerToken();
      // Conditional on the old token: two reclaims at once -> only one wins, the other gets a 409.
      const { data, error } = await db()
        .from(T.players)
        .update({
          token_hash: hashToken(token),
          device_hash: deviceHash ?? existing.device_hash,
          kick_requested_at: null,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("token_hash", existing.token_hash)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) fail(409, "Locul tocmai a fost reluat de altcineva. Mai încearcă o dată.");
      await touchRoom(room.id);
      await notifyRoom(room.id, "player_rejoined");
      return { code: room.code, playerId: existing.id, token, role: existing.role };
    }

    // A running game (or a full room) can only be watched: the newcomer becomes a spectator.
    const players = rows.filter((p) => p.role === "player");
    const spectate = room.status === "playing" || players.length >= MAX_PLAYERS;
    if (spectate && rows.length - players.length >= MAX_SPECTATORS) {
      fail(409, `Camera are deja ${MAX_SPECTATORS} spectatori, nu mai e loc nici pentru privit.`);
    }

    const token = newPlayerToken();
    const seat = Math.max(-1, ...players.map((p) => p.seat ?? -1)) + 1;
    const { data, error } = await db()
      .from(T.players)
      .insert({
        room_id: room.id,
        nickname,
        token_hash: hashToken(token),
        device_hash: deviceHash,
        role: spectate ? "spectator" : "player",
        seat: spectate ? null : seat,
      })
      .select("id")
      .single();
    if (isUniqueViolation(error)) fail(409, "Nickname-ul e deja folosit în cameră.");
    if (error) throw error;

    await touchRoom(room.id);
    await notifyRoom(room.id, spectate ? "spectator_joined" : "player_joined");
    return { code: room.code, playerId: data.id, token, role: spectate ? "spectator" : "player" };
  });
}
