import { notifyRoom } from "@/lib/server/broadcast";
import { handle } from "@/lib/server/http";
import { clearKicks, requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - host only, after a finished game. Back to the lobby,
// so players can join or leave before the next game.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");

    await saveRoom(room, { status: "lobby", round: room.round + 1, game: null });
    await clearKicks(room.id);
    await notifyRoom(room.id, "new_round");
    return { ok: true };
  });
}
