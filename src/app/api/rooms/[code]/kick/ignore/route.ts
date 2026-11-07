import { kickCutoffIso } from "@/lib/kick";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/kick/ignore - the kicked player (own token) refuses a pending kick and stays.
// Allowed until the grace period plus 2 s of network grace have passed; after that the removal is
// enforced (normally the caller is already gone and requireMember answered 401).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/kick/ignore">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.kick_requested_at === null) return { ok: true }; // nothing pending (already ignored)

    const { data, error } = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", player.id)
      .not("kick_requested_at", "is", null)
      .gte("kick_requested_at", kickCutoffIso(Date.now()))
      .select("id");
    if (error) throw error;
    if (!data || data.length === 0) fail(409, "Prea târziu, ai fost scos.");

    await notifyRoom(room.id, "kick_ignored");
    return { ok: true };
  });
}
