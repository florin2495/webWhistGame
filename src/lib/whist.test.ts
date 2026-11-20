import { describe, expect, it } from "vitest";
import {
  allowedBids,
  buildDeck,
  DEFAULT_SETTINGS,
  forbiddenBid,
  type GameState,
  handPoints,
  handSizes,
  isRoomAbandoned,
  isRoomExpired,
  leaders,
  legalCards,
  newGame,
  nextStreak,
  placeBid,
  playCard,
  PLAYING_IDLE_MINUTES,
  ROOM_ABANDONED_MS,
  ROOM_ABANDONED_PLAYING_MS,
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
    expect(buildDeck(5)).toHaveLength(40);
    expect(buildDeck(5)).toContain("S5");
    expect(buildDeck(5)).not.toContain("S4");
    expect(buildDeck(6)).toHaveLength(48);
    expect(buildDeck(6)).toContain("D3");
    expect(new Set(buildDeck(6)).size).toBe(48);
  });

  it("builds 1-8-1 and 8-1-8 sequences", () => {
    expect(handSizes(3, "1-8-1")).toEqual([1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 7, 6, 5, 4, 3, 2, 1, 1, 1]);
    expect(handSizes(4, "1-8-1")).toHaveLength(24);
    expect(handSizes(5, "1-8-1")).toHaveLength(27);
    expect(handSizes(6, "1-8-1")).toHaveLength(30);
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

  it("refuses 2 or 7 players", () => {
    expect(() => newGame(["a", "b"], DEFAULT_SETTINGS)).toThrow(RuleError);
    expect(() => newGame(["a", "b", "c", "d", "e", "f", "g"], DEFAULT_SETTINGS)).toThrow(RuleError);
  });

  it("deals 5 and 6 players exactly, with distinct cards and a trump under 8 cards", () => {
    for (const n of [5, 6]) {
      const seats = Array.from({ length: n }, (_, i) => `p${i}`);
      const g = newGame(seats, DEFAULT_SETTINGS, rng(n));
      const all = [...g.hands.flat(), g.trumpCard!];
      expect(g.hands.every((h) => h.length === 1)).toBe(true);
      expect(new Set(all).size).toBe(n + 1);
      const big = newGame(seats, { ...DEFAULT_SETTINGS, sequence: "8-1-8" }, rng(n));
      expect(big.hands.every((h) => h.length === 8)).toBe(true);
      expect(new Set(big.hands.flat()).size).toBe(n * 8);
      expect(big.trumpCard).toBeNull();
    }
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
  for (const n of [3, 4, 5, 6]) {
    it(`plays a whole ${n}-player game with legal random moves`, () => {
      const random = rng(7 + n);
      let g = newGame(Array.from({ length: n }, (_, i) => `p${i}`), DEFAULT_SETTINGS, random);
      let guard = 0;
      while (g.phase !== "over" && guard++ < 20_000) {
        if (g.phase === "bidding") {
          const options = allowedBids(g, g.turn);
          g = placeBid(g, g.turn, options[Math.floor(random() * options.length)]);
        } else {
          const legal = legalCards(g, g.turn);
          g = playCard(g, g.turn, legal[Math.floor(random() * legal.length)], random);
        }
      }
      expect(g.phase).toBe("over");
      expect(g.history).toHaveLength(3 * n + 12);
      for (const h of g.history) {
        expect(h.tricks.reduce((a, b) => a + b, 0)).toBe(h.handSize);
        expect(h.bids.reduce((a, b) => a + b, 0)).not.toBe(h.handSize);
      }
      expect(g.scores).toEqual(g.history.at(-1)!.totals);
    });
  }
});

describe("abandoned rooms", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const sec = (s: number) => new Date(now - s * 1000).toISOString();
  for (const status of ["lobby", "finished"]) {
    it(`${status}: abandoned after ${ROOM_ABANDONED_MS / 1000} s with nobody seen`, () => {
      expect(isRoomAbandoned(status, sec(601), [sec(900), sec(700)], now)).toBe(true);
      expect(isRoomAbandoned(status, sec(601), [], now)).toBe(true);
      expect(isRoomAbandoned(status, sec(601), [null], now)).toBe(true);
    });
    it(`${status}: kept while the last activity is recent`, () => {
      expect(isRoomAbandoned(status, sec(599), [], now)).toBe(false);
    });
    it(`${status}: kept while any player or spectator was seen recently`, () => {
      expect(isRoomAbandoned(status, sec(3000), [sec(3000), sec(30)], now)).toBe(false);
    });
  }
  it("playing: kept for up to 6 hours of silence", () => {
    expect(ROOM_ABANDONED_PLAYING_MS).toBe(6 * 3600_000);
    expect(isRoomAbandoned("playing", sec(601), [sec(601)], now)).toBe(false);
    expect(isRoomAbandoned("playing", sec(6 * 3600 - 1), [], now)).toBe(false);
    expect(isRoomAbandoned("playing", sec(6 * 3600 + 1), [sec(6 * 3600 + 1)], now)).toBe(true);
  });
});

describe("idle expiry", () => {
  const now = Date.parse("2026-11-14T12:00:00Z");
  const min = (m: number) => new Date(now - m * 60_000).toISOString();
  it("lobby / finished close after 10 minutes", () => {
    expect(isRoomExpired("lobby", min(9), now)).toBe(false);
    expect(isRoomExpired("finished", min(11), now)).toBe(true);
  });
  it("a running game closes only after 6 hours", () => {
    expect(PLAYING_IDLE_MINUTES).toBe(360);
    expect(isRoomExpired("playing", min(61), now)).toBe(false);
    expect(isRoomExpired("playing", min(359), now)).toBe(false);
    expect(isRoomExpired("playing", min(361), now)).toBe(true);
  });
});

describe("winners", () => {
  it("highest score wins when nobody ends on 0", () => {
    expect(leaders([12, 30, -4])).toEqual([1]);
    expect(leaders([30, 30, 5])).toEqual([0, 1]);
  });
  it("ending on exactly 0 wins, even over a higher score", () => {
    expect(leaders([45, 0, 12])).toEqual([1]);
    expect(leaders([0, 20, 0, -3])).toEqual([0, 2]);
  });
  it("no players, no winners", () => {
    expect(leaders([])).toEqual([]);
  });
});
