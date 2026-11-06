import { notifyRoom } from "@/lib/server/broadcast";
import { handle, readJson } from "@/lib/server/http";
import { parseSettings, requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/settings  { sequence?, bonus?, mustTrump? } - host only, in the lobby.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");

    const settings = parseSettings(await readJson(req), room.settings);
    await saveRoom(room, { settings });
    await notifyRoom(room.id, "settings_changed");
    return { ok: true };
  });
}
