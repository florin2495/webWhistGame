import { notifyRoom } from "@/lib/server/broadcast";
import { fail, handle } from "@/lib/server/http";
import { clearKicks, listPlayers, requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";
import { MAX_PLAYERS, MIN_PLAYERS, newGame, seatOrder } from "@/lib/whist";

// POST /api/rooms/[code]/start - host only, 3-4 players. Seats everyone and deals the first hand.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");

    const players = await listPlayers(room.id);
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      fail(409, `Whist se joacă în ${MIN_PLAYERS} sau ${MAX_PLAYERS} jucători. Acum sunteți ${players.length}.`);
    }

    const seats = seatOrder(
      players.map((p) => p.id),
      room.host_player_id,
      room.round,
    );
    const names = seats.map((id) => players.find((p) => p.id === id)!.nickname);
    await saveRoom(room, { status: "playing", game: { ...newGame(seats, room.settings), names } });

    await clearKicks(room.id);
    await notifyRoom(room.id, "game_started");
    return { ok: true };
  });
}
