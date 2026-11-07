// Pending kick: during a running game the host's "Scoate" does not remove the player at once.
// The player gets KICK_GRACE_MS to press "Ignoră"; after that the removal is enforced lazily
// on the next request (see enforceExpiredKicks in server/membership.ts). Pure, used by server and client.

export const KICK_GRACE_MS = 10_000;
/** Network grace on top of the visible countdown, used by both "ignore" and the enforcement. */
export const KICK_NETWORK_GRACE_MS = 2_000;
export const KICK_ENFORCE_MS = KICK_GRACE_MS + KICK_NETWORK_GRACE_MS;

type Stamp = string | number | Date;
const ms = (t: Stamp) => (t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t));

/** Milliseconds left to press "Ignoră", clamped to [0, KICK_GRACE_MS]; null when no kick is pending. */
export function kickRemainingMs(requestedAt: Stamp | null | undefined, now: number): number | null {
  if (requestedAt === null || requestedAt === undefined) return null;
  const t = ms(requestedAt);
  if (Number.isNaN(t)) return null;
  return Math.min(KICK_GRACE_MS, Math.max(0, t + KICK_GRACE_MS - now));
}

/** True once the grace period plus the network grace has run out: the player may be removed. */
export function isKickExpired(requestedAt: Stamp | null | undefined, now: number): boolean {
  if (requestedAt === null || requestedAt === undefined) return false;
  const t = ms(requestedAt);
  return !Number.isNaN(t) && t < now - KICK_ENFORCE_MS;
}

/** Players whose kick_requested_at is older than this instant are due for removal. */
export function kickCutoffIso(now: number): string {
  return new Date(now - KICK_ENFORCE_MS).toISOString();
}

/** Whole seconds to show for a remaining time (rounds up, so 0 means really over). */
export function secondsLabel(remainingMs: number): number {
  return Math.ceil(Math.max(0, remainingMs) / 1000);
}
