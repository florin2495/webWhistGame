import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { handle } from "@/lib/server/http";
import { clearKicks, listMembers, requireHost, requireMember, requireStatus, saveRoom, sortSpectators } from "@/lib/server/room";
import { nextRoundOrder } from "@/lib/spectators";
import { MAX_PLAYERS } from "@/lib/whist";

// POST /api/rooms/[code]/new-round - host only, after a finished game. Back to the lobby,
// so players can join or leave before the next game. Queued spectators take the free seats.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");

    await saveRoom(room, { status: "lobby", round: room.round + 1, game: null });

    // Next round's order: the previous opener moves to the end, queued spectators follow in queue order.
    const members = await listMembers(room.id);
    const players = members.filter((p) => p.role === "player");
    const queued = sortSpectators(members).filter((p) => p.queued_at !== null);
    const { order, promoted } = nextRoundOrder(
      players.map((p) => p.id),
      queued.map((p) => p.id),
      MAX_PLAYERS,
    );
    for (const [i, id] of order.entries()) {
      const update = promoted.includes(id) ? { role: "player", seat: i, queued_at: null } : { seat: i };
      const { error } = await db().from(T.players).update(update).eq("id", id).eq("room_id", room.id);
      if (error) throw error;
    }

    await clearKicks(room.id);
    await notifyRoom(room.id, "new_round");
    return { ok: true };
  });
}
