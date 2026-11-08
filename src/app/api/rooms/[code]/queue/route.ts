import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/queue - a spectator toggles "Intră la runda următoare". At the next new-round the queued
// spectators become players, in queue order, while seats are free; the rest stay spectators.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.role !== "spectator") fail(409, "Ești deja jucător.");

    const queued = player.queued_at === null;
    const { error } = await db()
      .from(T.players)
      .update({ queued_at: queued ? new Date().toISOString() : null })
      .eq("id", player.id);
    if (error) throw error;
    await notifyRoom(room.id, "queue_changed");
    return { ok: true, queued };
  });
}
