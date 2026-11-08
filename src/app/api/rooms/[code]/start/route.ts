import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle } from "@/lib/server/http";
import { clearKicks, listPlayers, requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";
import { MAX_PLAYERS, MIN_PLAYERS, newGame } from "@/lib/whist";

// POST /api/rooms/[code]/start - host only, 3-6 players. Seats everyone and deals the first hand.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");

    const players = await listPlayers(room.id);
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      fail(409, `Whist se joacă în ${MIN_PLAYERS}-${MAX_PLAYERS} jucători. Acum sunteți ${players.length}.`);
    }

    // Spectators never get a seat. The order is the one the host set (see reorder / new-round).
    const seats = players.map((p) => p.id);
    const names = seats.map((id) => players.find((p) => p.id === id)!.nickname);
    await saveRoom(room, { status: "playing", game: { ...newGame(seats, room.settings), names } });

    await clearKicks(room.id);
    await notifyRoom(room.id, "game_started");
    return { ok: true };
  });
}
