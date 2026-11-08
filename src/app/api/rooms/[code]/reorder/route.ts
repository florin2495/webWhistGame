import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireHost, requireMember, requireStatus, touchRoom } from "@/lib/server/room";
import { isPermutation } from "@/lib/spectators";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, in the lobby (never mid-game).
// `order` must be a full permutation of the players; the first one opens the game, the rest follow.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");

    const { order } = await readJson(req);
    const players = await listPlayers(room.id);
    if (!isPermutation(order, players.map((p) => p.id))) fail(400, "Ordinea trebuie să conțină toți jucătorii, o dată fiecare.");

    for (const [i, id] of order.entries()) {
      const { error } = await db().from(T.players).update({ seat: i }).eq("id", id).eq("room_id", room.id);
      if (error) throw error;
    }
    await touchRoom(room.id);
    await notifyRoom(room.id, "order_changed");
    return { ok: true };
  });
}
