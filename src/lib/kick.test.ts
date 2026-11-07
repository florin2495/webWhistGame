import { describe, expect, it } from "vitest";
import { isKickExpired, KICK_ENFORCE_MS, KICK_GRACE_MS, kickCutoffIso, kickRemainingMs, secondsLabel } from "./kick";

const T0 = Date.parse("2026-01-01T12:00:00.000Z");
const at = new Date(T0).toISOString();

describe("kickRemainingMs", () => {
  it("is null without a pending kick", () => {
    expect(kickRemainingMs(null, T0)).toBeNull();
    expect(kickRemainingMs(undefined, T0)).toBeNull();
    expect(kickRemainingMs("garbage", T0)).toBeNull();
  });
  it("counts down and clamps to [0, grace]", () => {
    expect(kickRemainingMs(at, T0)).toBe(KICK_GRACE_MS);
    expect(kickRemainingMs(at, T0 + 3_000)).toBe(7_000);
    expect(kickRemainingMs(at, T0 + KICK_GRACE_MS)).toBe(0);
    expect(kickRemainingMs(at, T0 + 60_000)).toBe(0);
    expect(kickRemainingMs(at, T0 - 5_000)).toBe(KICK_GRACE_MS); // clock skew: never above the grace
  });
  it("accepts Date and number stamps", () => {
    expect(kickRemainingMs(new Date(T0), T0 + 1_000)).toBe(9_000);
    expect(kickRemainingMs(T0, T0 + 1_000)).toBe(9_000);
  });
});

describe("isKickExpired", () => {
  it("waits for the grace plus the network grace", () => {
    expect(isKickExpired(null, T0 + 1e6)).toBe(false);
    expect(isKickExpired(at, T0 + KICK_GRACE_MS)).toBe(false);
    expect(isKickExpired(at, T0 + KICK_ENFORCE_MS)).toBe(false);
    expect(isKickExpired(at, T0 + KICK_ENFORCE_MS + 1)).toBe(true);
  });
  it("cutoff matches the expiry rule", () => {
    expect(kickCutoffIso(T0 + KICK_ENFORCE_MS)).toBe(at);
  });
});

describe("secondsLabel", () => {
  it("rounds up", () => {
    expect(secondsLabel(10_000)).toBe(10);
    expect(secondsLabel(9_001)).toBe(10);
    expect(secondsLabel(1)).toBe(1);
    expect(secondsLabel(0)).toBe(0);
    expect(secondsLabel(-5)).toBe(0);
  });
});
