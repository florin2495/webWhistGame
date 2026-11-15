import "server-only";
import { type GameState, leaders, RuleError } from "@/lib/whist";
import { notifyRoom } from "./broadcast";
import { fail, handle, readJson } from "./http";
import { reportLeaderboard } from "./leaderboard";
import { publicGame, requireMember, requireStatus, saveRoom } from "./room";

/**
 * Shared body of every in-game move (bid, play): authenticates the caller, applies the pure
 * rule `apply` to the stored state and saves the result with the optimistic lock.
 * A finished game flips the room to "finished".
 */
export function moveHandler(
  req: Request,
  code: string,
  kind: string,
  apply: (game: GameState, seat: number, body: Record<string, unknown>) => GameState,
): Promise<Response> {
  return handle(async () => {
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "playing");
    const game = room.game;
    if (!game) fail(409, "Jocul nu a început încă.");
    const seat = game.seats.indexOf(player.id);
    if (seat < 0) fail(403, "Nu joci în acest joc.");
    const body = await readJson(req);

    let next: GameState;
    try {
      next = apply(game, seat, body);
    } catch (err) {
      if (err instanceof RuleError) fail(409, err.message);
      throw err;
    }

    const saved = { ...next, names: game.names };
    await saveRoom(room, {
      game: saved,
      ...(next.phase === "over" ? { status: "finished" as const } : {}),
    });
    if (next.phase === "over" && !next.abortedBy) {
      await reportLeaderboard(room, game.names, leaders(next.scores));
    }
    await notifyRoom(room.id, kind);
    // Enough for the mover to update its own screen without re-fetching /state.
    return { ok: true, status: next.phase === "over" ? "finished" : "playing", game: publicGame(saved, player.id) };
  });
}
