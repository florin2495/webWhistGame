// Spectators and play order, pure (server and tests).

/** Spectators allowed per room. */
export const MAX_SPECTATORS = 16;

/** True when `order` lists every id of `current` exactly once. */
export function isPermutation(order: unknown, current: string[]): order is string[] {
  if (!Array.isArray(order) || order.length !== current.length) return false;
  if (!order.every((x) => typeof x === "string")) return false;
  const set = new Set(order as string[]);
  return set.size === current.length && current.every((id) => set.has(id));
}

/**
 * Play order of the next round: the previous order shifted by one (the player who opened last goes to the
 * end, like the old per-round rotation; the host can reorder afterwards), then queued spectators in queue
 * order while seats are free (`max`).
 */
export function nextRoundOrder(playerIds: string[], queuedIds: string[], max: number): { order: string[]; promoted: string[] } {
  const rotated = playerIds.length > 1 ? [...playerIds.slice(1), playerIds[0]] : [...playerIds];
  const promoted = queuedIds.slice(0, Math.max(0, max - rotated.length));
  return { order: [...rotated, ...promoted], promoted };
}
