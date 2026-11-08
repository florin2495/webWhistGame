import { describe, expect, it } from "vitest";
import {
  allowedBids,
  buildDeck,
  DEFAULT_SETTINGS,
  forbiddenBid,
  type GameState,
  handPoints,
  handSizes,
  legalCards,
  newGame,
  nextStreak,
  placeBid,
  playCard,
  RuleError,
  trickWinner,
} from "./whist";

/** Deterministic PRNG for reproducible deals. */
function rng(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

describe("deck and structure", () => {
  it("uses 8 cards per player", () => {
    expect(buildDeck(3)).toHaveLength(24);
    expect(buildDeck(4)).toHaveLength(32);
    expect(buildDeck(3)).not.toContain("S8");
    expect(buildDeck(4)).toContain("S7");
    expect(new Set(buildDeck(4)).size).toBe(32);
  });

  it("builds 1-8-1 and 8-1-8 sequences", () => {
    expect(handSizes(3, "1-8-1")).toEqual([1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1]);
    expect(handSizes(4, "1-8-1")).toHaveLength(24);
    expect(handSizes(4, "8-1-8").slice(0, 5)).toEqual([8, 8, 8, 8, 7]);
  });
});

describe("dealing", () => {
  it("deals the hand size and turns up a trump under 8 cards", () => {
    const g = newGame(["a", "b", "c"], DEFAULT_SETTINGS, rng());
    expect(g.hands.map((h) => h.length)).toEqual([1, 1, 1]);
    expect(g.trumpCard).not.toBeNull();
    expect(g.hands.flat()).not.toContain(g.trumpCard);
  });

  it("has no trump on 8-card hands", () => {
    const g = newGame(["a", "b", "c", "d"], { ...DEFAULT_SETTINGS, sequence: "8-1-8" }, rng());
    expect(g.hands.map((h) => h.length)).toEqual([8, 8, 8, 8]);
    expect(g.trumpCard).toBeNull();
  });

  it("refuses 2 or 5 players", () => {
    expect(() => newGame(["a", "b"], DEFAULT_SETTINGS)).toThrow(RuleError);
    expect(() => newGame(["a", "b", "c", "d", "e"], DEFAULT_SETTINGS)).toThrow(RuleError);
  });
});

describe("bidding", () => {
  it("forbids the dealer from making the total equal the hand size", () => {
    let g = newGame(["a", "b", "c"], DEFAULT_SETTINGS, rng());
    // hand 0: seat 0 bids first, seat 2 deals and bids last
    g = placeBid(g, 0, 1);
    expect(forbiddenBid(g, 1)).toBeNull();
    g = placeBid(g, 1, 0);
    expect(forbiddenBid(g, 2)).toBe(0);
    expect(allowedBids(g, 2)).toEqual([1]);
    expect(() => placeBid(g, 2, 0)).toThrow(/Ultimul/);
    g = placeBid(g, 2, 1);
    expect(g.phase).toBe("playing");
    expect(g.turn).toBe(0);
  });

  it("enforces turn order", () => {
    const g = newGame(["a", "b", "c"], DEFAULT_SETTINGS, rng());
    expect(() => placeBid(g, 1, 0)).toThrow(/rândul/);
  });

  it("allows every bid to the dealer when the total already exceeds the hand", () => {
    let g = newGame(["a", "b", "c"], DEFAULT_SETTINGS, rng());
    g = placeBid(placeBid(g, 0, 1), 1, 1);
    expect(forbiddenBid(g, 2)).toBeNull();
    expect(allowedBids(g, 2)).toEqual([0, 1]);
  });
});

describe("tricks", () => {
  it("highest trump wins, else highest of the led suit", () => {
    expect(trickWinner([{ seat: 0, card: "H10" }, { seat: 1, card: "H14" }, { seat: 2, card: "S9" }], null)).toBe(1);
    expect(trickWinner([{ seat: 0, card: "H10" }, { seat: 1, card: "H14" }, { seat: 2, card: "S9" }], "S")).toBe(2);
    expect(trickWinner([{ seat: 0, card: "H10" }, { seat: 1, card: "D14" }, { seat: 2, card: "H9" }], "S")).toBe(0);
    expect(trickWinner([{ seat: 0, card: "S9" }, { seat: 1, card: "S13" }, { seat: 2, card: "H14" }], "S")).toBe(1);
  });

  const base = (hands: string[][], trumpCard: string | null, trick: { seat: number; card: string }[] = []): GameState => ({
    ...newGame(["a", "b", "c"], DEFAULT_SETTINGS, rng()),
    phase: "playing",
    hands,
    trumpCard,
    trick,
    turn: trick.length,
    bids: [0, 0, 0],
  });

  it("must follow suit, then must trump", () => {
    const g = base([["H9"], ["H10", "S11", "D9"], ["C9"]], "S13", [{ seat: 0, card: "H12" }]);
    expect(legalCards(g, 1)).toEqual(["H10"]);
    const noHeart = base([["H9"], ["C10", "S11", "D9"], ["C9"]], "S13", [{ seat: 0, card: "H12" }]);
    expect(legalCards(noHeart, 1)).toEqual(["S11"]);
    expect(() => playCard(noHeart, 1, "C10")).toThrow(/atu/);
    const free = { ...noHeart, settings: { ...noHeart.settings, mustTrump: false } };
    expect(legalCards(free, 1)).toHaveLength(3);
  });
});

describe("scoring", () => {
  it("exact = 5 + bid, miss = -difference", () => {
    expect(handPoints(0, 0)).toBe(5);
    expect(handPoints(3, 3)).toBe(8);
    expect(handPoints(2, 0)).toBe(-2);
    expect(handPoints(1, 4)).toBe(-3);
  });

  it("pays +10 at 5 exact in a row and -10 at 5 misses, then restarts", () => {
    let s = 0;
    const bonuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = nextStreak(s, true, true);
      s = r.streak;
      bonuses.push(r.bonus);
    }
    expect(bonuses).toEqual([0, 0, 0, 0, 10]);
    expect(s).toBe(0);
    expect(nextStreak(-4, false, true)).toEqual({ streak: 0, bonus: -10 });
    expect(nextStreak(3, false, true)).toEqual({ streak: -1, bonus: 0 });
    expect(nextStreak(4, true, false)).toEqual({ streak: 5, bonus: 0 });
  });
});

describe("full game", () => {
  it("plays a whole 3-player game with legal random moves", () => {
    const random = rng(7);
    let g = newGame(["a", "b", "c"], DEFAULT_SETTINGS, random);
    let guard = 0;
    while (g.phase !== "over" && guard++ < 10_000) {
      if (g.phase === "bidding") {
        const options = allowedBids(g, g.turn);
        g = placeBid(g, g.turn, options[Math.floor(random() * options.length)]);
      } else {
        const legal = legalCards(g, g.turn);
        g = playCard(g, g.turn, legal[Math.floor(random() * legal.length)], random);
      }
    }
    expect(g.phase).toBe("over");
    expect(g.history).toHaveLength(21);
    for (const h of g.history) {
      expect(h.tricks.reduce((a, b) => a + b, 0)).toBe(h.handSize);
      expect(h.bids.reduce((a, b) => a + b, 0)).not.toBe(h.handSize);
    }
    expect(g.scores).toEqual(g.history.at(-1)!.totals);
  });
});
