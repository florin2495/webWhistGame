import "server-only";
import { db } from "./db";
import { isUniqueViolation } from "./http";

const GAME = "whist";

/** player_key = nickname lowercased and trimmed (no accounts: same nickname = same person). */
export const playerKey = (nickname: string) => nickname.trim().toLowerCase();

/**
 * Reports a finished game to the hub's shared leaderboard (hub_leaderboard / hub_leaderboard_rounds, owned by
 * florin2495/hailataticu-hub): +1 games for every player, +1 wins for the winners. Idempotent per
 * (game, room code, round): the round row is inserted first and a duplicate means "already counted".
 * Best effort: a failure is logged and never breaks the move that ended the game.
 */
export async function reportLeaderboard(roomCode: string, roundNo: number, names: string[], winners: number[]): Promise<void> {
  try {
    const claim = await db().from("hub_leaderboard_rounds").insert({ game: GAME, room_code: roomCode, round_no: roundNo });
    if (claim.error) {
      if (isUniqueViolation(claim.error)) return; // already counted
      throw claim.error;
    }
    for (const [seat, name] of names.entries()) {
      const key = playerKey(name);
      if (!key) continue;
      const { data, error } = await db().from("hub_leaderboard").select("wins, games").eq("game", GAME).eq("player_key", key).maybeSingle();
      if (error) throw error;
      const { error: upsertError } = await db()
        .from("hub_leaderboard")
        .upsert(
          {
            game: GAME,
            player_key: key,
            display_name: name.trim(),
            wins: (data?.wins ?? 0) + (winners.includes(seat) ? 1 : 0),
            games: (data?.games ?? 0) + 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "game,player_key" },
        );
      if (upsertError) throw upsertError;
    }
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
