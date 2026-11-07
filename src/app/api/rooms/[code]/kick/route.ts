import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { removePlayer } from "@/lib/server/membership";
import { requireHost, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/kick  { playerId } - host removes another player. In a lobby / finished game or for a
// non-seated player at once; for a seated player of a running game it starts a 10 s pending kick instead
// (the player can press "Ignoră", see kick/ignore; otherwise it is enforced by enforceExpiredKicks).
// Not a ban: identity is a browser token, so a kicked player could rejoin a lobby under a
// new nickname. A room password is the real access control.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);

    const body = await readJson(req);
    const targetId = typeof body.playerId === "string" ? body.playerId : "";
    if (targetId === player.id) fail(400, "Nu te poți scoate singur. Folosește „Părăsește camera”.");

    const { data: target, error } = await db()
      .from(T.players)
      .select("id, kick_requested_at")
      .eq("id", targetId)
      .eq("room_id", room.id)
      .maybeSingle();
    if (error && error.code !== "22P02") throw error; // 22P02 = malformed uuid
    if (!target) fail(404, "Jucătorul nu mai e în cameră.");

    // A game is "in progress" when the room is playing and the target holds a seat in it. Only those
    // players get the 10 s "Ignoră" window; spectators (not seated) and lobby/finished rooms: immediate.
    const inGame = room.status === "playing" && room.game !== null && room.game.seats.includes(targetId);
    if (inGame) {
      if (target.kick_requested_at === null) {
        // Single clock (this server) for stamp, expiry check and /state countdown: no DB/app skew.
        const { error: stampError } = await db()
          .from(T.players)
          .update({ kick_requested_at: new Date().toISOString() })
          .eq("id", targetId)
          .is("kick_requested_at", null); // a second kick never resets the deadline
        if (stampError) throw stampError;
        await notifyRoom(room.id, "kick_pending");
      }
      return { ok: true, pending: true };
    }

    await removePlayer(room, targetId, "player_kicked");
    return { ok: true };
  });
}
