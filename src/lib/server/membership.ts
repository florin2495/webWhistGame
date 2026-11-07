import "server-only";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow, T } from "./db";
import { kickCutoffIso } from "@/lib/kick";
import { ApiError } from "./http";
import { listPlayers, reloadRoom, saveRoom } from "./room";

/**
 * Removes a player from a room (used by both "leave" and the host's "kick").
 *  - last player out: the room is deleted
 *  - host removed: host passes to the next player in join order
 *  - during a game: Whist cannot go on with one seat missing (the deck depends on the
 *    number of players), so the game stops; the score sheet stays visible.
 */
export async function removePlayer(room: RoomRow, playerId: string, reason: string): Promise<{ roomClosed: boolean }> {
  const players = await listPlayers(room.id);
  const leaving = players.find((p) => p.id === playerId);
  const remaining = players.filter((p) => p.id !== playerId);

  if (remaining.length === 0) {
    const { error } = await db().from(T.rooms).delete().eq("id", room.id);
    if (error) throw error;
    return { roomClosed: true };
  }

  const newHostId = room.host_player_id === playerId ? remaining[0].id : room.host_player_id;
  const update: Partial<RoomRow> = { host_player_id: newHostId };
  if (room.status === "playing" && room.game?.seats.includes(playerId)) {
    update.status = "finished";
    update.game = { ...room.game, phase: "over", abortedBy: leaving?.nickname ?? "un jucător" };
  }

  // Update the room first so the host never points at a deleted player.
  await saveRoom(room, update);

  if (newHostId && newHostId !== room.host_player_id) {
    const { error } = await db().from(T.players).update({ is_host: true }).eq("id", newHostId);
    if (error) throw error;
  }

  const { error: deleteError } = await db().from(T.players).delete().eq("id", playerId);
  if (deleteError) throw deleteError;

  await notifyRoom(room.id, reason);
  return { roomClosed: false };
}

/**
 * Removes every player whose pending kick has run out (10 s + 2 s network grace), exactly like the
 * host's immediate kick (removePlayer). Called from requireMember, i.e. at the start of /state and of
 * every room route. Each removal is claimed atomically ("clear the stamp where it still has the value
 * we read"), so concurrent requests never remove the same player twice. Returns the room as it is
 * afterwards, or null when it was deleted (last player removed).
 */
export async function enforceExpiredKicks(room: RoomRow): Promise<RoomRow | null> {
  const { data, error } = await db()
    .from(T.players)
    .select("id, kick_requested_at")
    .eq("room_id", room.id)
    .not("kick_requested_at", "is", null)
    .lt("kick_requested_at", kickCutoffIso(Date.now()));
  if (error) throw error;
  const due = (data ?? []) as { id: string; kick_requested_at: string }[];
  if (due.length === 0) return room;

  let current: RoomRow | null = room;
  for (const row of due) {
    if (!current) return null;
    const claim = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", row.id)
      .eq("kick_requested_at", row.kick_requested_at)
      .select("id");
    if (claim.error) throw claim.error;
    if (!claim.data || claim.data.length === 0) {
      current = await reloadRoom(room.id); // somebody else claimed it (or it was ignored)
      continue;
    }
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await removePlayer(current, row.id, "player_kicked");
          break;
        } catch (err) {
          // Optimistic lock lost (a move landed meanwhile): re-read the room and try again.
          if (!(err instanceof ApiError && err.status === 409) || attempt >= 2) throw err;
          const fresh = await reloadRoom(room.id);
          if (!fresh) return null;
          current = fresh;
        }
      }
    } catch (err) {
      // Could not remove: give the stamp back so the next request retries.
      await db().from(T.players).update({ kick_requested_at: row.kick_requested_at }).eq("id", row.id).is("kick_requested_at", null);
      throw err;
    }
    current = await reloadRoom(room.id);
  }
  return current;
}
