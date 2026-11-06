import "server-only";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow, T } from "./db";
import { listPlayers, saveRoom } from "./room";

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
