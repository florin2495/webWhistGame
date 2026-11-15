// Pure Whist rules (Romanian "whist cu licitație") - shared by server and client, no I/O.

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const NICKNAME_MAX = 10;
/** Cards per player in the biggest hand. The deck has 8 cards per player. */
export const MAX_HAND = 8;

/** Lobby/finished rooms close after this long with nobody having them open. */
export const ROOM_IDLE_MINUTES = 10;
/** A game in progress that nobody has open closes after this long (6 hours, same as ROOM_ABANDONED_PLAYING_MS). */
export const PLAYING_IDLE_MINUTES = 6 * 60;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;

export const EXACT_BASE = 5;
export const STREAK_LENGTH = 5;
export const STREAK_BONUS = 10;

export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  const idle = now - new Date(lastActivityAt).getTime();
  if (status === "playing") return idle > PLAYING_IDLE_MINUTES * 60_000;
  return idle > ROOM_IDLE_MINUTES * 60_000;
}

/**
 * A lobby / finished room is abandoned once its last activity is older than this AND no player or spectator
 * has been seen within it. Swept every time the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 600_000;
/** Same rule for a game in progress ("playing"): 6 hours, so locked phones / backgrounded tabs don't kill a live game. */
export const ROOM_ABANDONED_PLAYING_MS = 6 * 3600_000;

/** The abandoned-room threshold for a room in this status. */
export function abandonedAfterMs(status: string): number {
  return status === "playing" ? ROOM_ABANDONED_PLAYING_MS : ROOM_ABANDONED_MS;
}

export function isRoomAbandoned(
  status: string,
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const limit = abandonedAfterMs(status);
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= limit;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export type Suit = "S" | "H" | "D" | "C";
export const SUITS: Suit[] = ["S", "H", "C", "D"]; // display order: alternate colours
/** 3..14 (11 = J, 12 = Q, 13 = K, 14 = A) */
export type Rank = number;
/** Compact card id: suit + rank, e.g. "H14" = A♥, "S10" = 10♠. */
export type Card = string;

export const suitOf = (c: Card): Suit => c[0] as Suit;
export const rankOf = (c: Card): Rank => Number(c.slice(1));
export const card = (s: Suit, r: Rank): Card => `${s}${r}`;

export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME: Record<Suit, string> = { S: "pică", H: "cupă", D: "caro", C: "treflă" };
export const isRed = (s: Suit) => s === "H" || s === "D";

export function rankLabel(r: Rank): string {
  return ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[r] ?? String(r);
}

export function isCard(value: unknown): value is Card {
  if (typeof value !== "string" || !/^[SHDC]([3-9]|1[0-4])$/.test(value)) return false;
  return true;
}

/**
 * The 8 highest cards of each suit per player, so every deal is exact and the 8-card hand uses the whole deck:
 * 3 players -> 9..A (24 cards), 4 -> 7..A (32), 5 -> 5..A (40), 6 -> 3..A (48).
 */
export function buildDeck(players: number): Card[] {
  const lowest = 15 - (MAX_HAND * players) / 4;
  const deck: Card[] = [];
  for (const s of SUITS) for (let r = lowest; r <= 14; r++) deck.push(card(s, r));
  return deck;
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Sorted for display: by suit (alternating colours, trump first), then rank descending. */
export function sortHand(hand: Card[], trump: Suit | null): Card[] {
  const order = trump ? [trump, ...SUITS.filter((s) => s !== trump)] : SUITS;
  return [...hand].sort(
    (a, b) => order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || rankOf(b) - rankOf(a),
  );
}

// ---------------------------------------------------------------------------
// Game structure
// ---------------------------------------------------------------------------

export type Sequence = "1-8-1" | "8-1-8";
export const SEQUENCES: Sequence[] = ["1-8-1", "8-1-8"];

export interface Settings {
  sequence: Sequence;
  /** +10 after 5 exact bids in a row, -10 after 5 misses in a row. */
  bonus: boolean;
  /** Without the led suit, you must play a trump if you have one. */
  mustTrump: boolean;
}

export const DEFAULT_SETTINGS: Settings = { sequence: "1-8-1", bonus: true, mustTrump: true };

/**
 * Hand sizes of a whole game. 1-8-1 with n players: n hands of 1, then 2..7, n hands of 8,
 * 7..2, n hands of 1 (3n + 12 hands). 8-1-8 is the same, mirrored.
 */
export function handSizes(players: number, sequence: Sequence): number[] {
  const rep = (size: number) => Array<number>(players).fill(size);
  const up = [2, 3, 4, 5, 6, 7];
  const down = [7, 6, 5, 4, 3, 2];
  return sequence === "1-8-1"
    ? [...rep(1), ...up, ...rep(MAX_HAND), ...down, ...rep(1)]
    : [...rep(MAX_HAND), ...down, ...rep(1), ...up, ...rep(MAX_HAND)];
}

/** Seat that bids and leads first in hand `handIndex` (the player after the dealer). */
export const firstSeat = (handIndex: number, n: number) => handIndex % n;
/** Dealer seat of hand `handIndex`. */
export const dealerSeat = (handIndex: number, n: number) => (handIndex + n - 1) % n;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface Play {
  seat: number;
  card: Card;
}

export interface HandResult {
  handSize: number;
  trump: Suit | null;
  dealer: number;
  bids: number[];
  tricks: number[];
  /** Points for the hand, bonus included. */
  points: number[];
  /** Bonus part of `points` (+10 / -10 / 0). */
  bonus: number[];
  totals: number[];
}

/** Full server-side game state, kept as jsonb on the room. Hands are secret - see publicView. */
export interface GameState {
  settings: Settings;
  /** Player ids by seat. */
  seats: string[];
  sizes: number[];
  handIndex: number;
  phase: "bidding" | "playing" | "over";
  /** Upturned card that sets trump (null on 8-card hands: no trump). */
  trumpCard: Card | null;
  hands: Card[][];
  bids: (number | null)[];
  tricks: number[];
  /** Seat whose move it is (bid or card). */
  turn: number;
  /** Cards on the table, in play order. */
  trick: Play[];
  /** Last completed trick of the current game, so everyone can see it. */
  lastTrick: { plays: Play[]; winner: number } | null;
  scores: number[];
  /** Positive = exact bids in a row, negative = misses in a row. */
  streaks: number[];
  history: HandResult[];
  /** Set when the game was stopped early (a player left). */
  abortedBy: string | null;
}

export const trumpOf = (g: Pick<GameState, "trumpCard">): Suit | null => (g.trumpCard ? suitOf(g.trumpCard) : null);

function deal(g: GameState, random: () => number): GameState {
  const n = g.seats.length;
  const size = g.sizes[g.handIndex];
  const deck = shuffle(buildDeck(n), random);
  const first = firstSeat(g.handIndex, n);
  return {
    ...g,
    phase: "bidding",
    hands: Array.from({ length: n }, (_, seat) => deck.slice(seat * size, seat * size + size)),
    trumpCard: size < MAX_HAND ? deck[n * size] : null,
    bids: Array<number | null>(n).fill(null),
    tricks: Array<number>(n).fill(0),
    turn: first,
    trick: [],
    lastTrick: null,
  };
}

export function newGame(seats: string[], settings: Settings, random: () => number = Math.random): GameState {
  const n = seats.length;
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) throw new RuleError(`Whist se joacă în ${MIN_PLAYERS}-${MAX_PLAYERS} jucători.`);
  return deal(
    {
      settings,
      seats,
      sizes: handSizes(n, settings.sequence),
      handIndex: 0,
      phase: "bidding",
      trumpCard: null,
      hands: [],
      bids: [],
      tricks: [],
      turn: 0,
      trick: [],
      lastTrick: null,
      scores: Array<number>(n).fill(0),
      streaks: Array<number>(n).fill(0),
      history: [],
      abortedBy: null,
    },
    random,
  );
}

/** An illegal move. Message is safe to show to the player. */
export class RuleError extends Error {}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

/** True if `seat` is the last to bid in this hand (the dealer). */
export function isLastBidder(g: GameState, seat: number): boolean {
  return seat === dealerSeat(g.handIndex, g.seats.length);
}

/**
 * The one bid the dealer may not make: the value that would make the bids add up to the
 * number of cards (so somebody must miss). Null for everyone else.
 */
export function forbiddenBid(g: GameState, seat: number): number | null {
  if (!isLastBidder(g, seat)) return null;
  const sum = g.bids.reduce<number>((acc, b, i) => (i === seat ? acc : acc + (b ?? 0)), 0);
  const v = g.sizes[g.handIndex] - sum;
  return v >= 0 ? v : null;
}

export function allowedBids(g: GameState, seat: number): number[] {
  const size = g.sizes[g.handIndex];
  const no = forbiddenBid(g, seat);
  return Array.from({ length: size + 1 }, (_, i) => i).filter((b) => b !== no);
}

export function placeBid(g: GameState, seat: number, bid: number): GameState {
  if (g.phase !== "bidding") throw new RuleError("Nu se mai licitează în mâna asta.");
  if (g.turn !== seat) throw new RuleError("Nu e rândul tău.");
  if (!Number.isInteger(bid) || !allowedBids(g, seat).includes(bid)) {
    const no = forbiddenBid(g, seat);
    throw new RuleError(
      no !== null && bid === no
        ? `Ultimul nu poate spune ${no}: totalul ar fi egal cu numărul de cărți.`
        : "Licitație invalidă.",
    );
  }
  const bids = [...g.bids];
  bids[seat] = bid;
  const n = g.seats.length;
  const done = bids.every((b) => b !== null);
  return {
    ...g,
    bids,
    phase: done ? "playing" : "bidding",
    turn: done ? firstSeat(g.handIndex, n) : (seat + 1) % n,
  };
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

/** Cards `seat` may play now: follow suit; else trump if mustTrump and you have one; else anything. */
export function legalCards(g: GameState, seat: number): Card[] {
  const hand = g.hands[seat] ?? [];
  if (g.trick.length === 0) return hand;
  const led = suitOf(g.trick[0].card);
  const follow = hand.filter((c) => suitOf(c) === led);
  if (follow.length) return follow;
  const trump = trumpOf(g);
  if (g.settings.mustTrump && trump) {
    const trumps = hand.filter((c) => suitOf(c) === trump);
    if (trumps.length) return trumps;
  }
  return hand;
}

/** Seat that wins a complete trick: highest trump, else highest card of the led suit. */
export function trickWinner(plays: Play[], trump: Suit | null): number {
  const led = suitOf(plays[0].card);
  let best = plays[0];
  for (const p of plays.slice(1)) {
    const s = suitOf(p.card);
    const bs = suitOf(best.card);
    const beats =
      (s === trump && bs !== trump) || (s === bs && rankOf(p.card) > rankOf(best.card) && (s === led || s === trump));
    if (beats) best = p;
  }
  return best.seat;
}

/** Points for one player's hand, before the streak bonus. */
export function handPoints(bid: number, tricks: number): number {
  return bid === tricks ? EXACT_BASE + bid : -Math.abs(bid - tricks);
}

/** New streak and bonus after a hand. A streak pays once at 5 and then starts over. */
export function nextStreak(streak: number, exact: boolean, bonusOn: boolean): { streak: number; bonus: number } {
  let s = exact ? (streak > 0 ? streak + 1 : 1) : streak < 0 ? streak - 1 : -1;
  let bonus = 0;
  if (bonusOn && s >= STREAK_LENGTH) {
    bonus = STREAK_BONUS;
    s = 0;
  } else if (bonusOn && s <= -STREAK_LENGTH) {
    bonus = -STREAK_BONUS;
    s = 0;
  }
  return { streak: s, bonus };
}

function scoreHand(g: GameState): GameState {
  const n = g.seats.length;
  const points: number[] = [];
  const bonus: number[] = [];
  const streaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const bid = g.bids[i] ?? 0;
    const base = handPoints(bid, g.tricks[i]);
    const st = nextStreak(g.streaks[i], bid === g.tricks[i], g.settings.bonus);
    streaks.push(st.streak);
    bonus.push(st.bonus);
    points.push(base + st.bonus);
  }
  const scores = g.scores.map((s, i) => s + points[i]);
  const result: HandResult = {
    handSize: g.sizes[g.handIndex],
    trump: trumpOf(g),
    dealer: dealerSeat(g.handIndex, n),
    bids: g.bids.map((b) => b ?? 0),
    tricks: [...g.tricks],
    points,
    bonus,
    totals: scores,
  };
  return { ...g, scores, streaks, history: [...g.history, result] };
}

export function playCard(g: GameState, seat: number, c: Card, random: () => number = Math.random): GameState {
  if (g.phase !== "playing") throw new RuleError(g.phase === "bidding" ? "Întâi se licitează." : "Jocul s-a terminat.");
  if (g.turn !== seat) throw new RuleError("Nu e rândul tău.");
  if (!g.hands[seat].includes(c)) throw new RuleError("Nu ai cartea asta.");
  if (!legalCards(g, seat).includes(c)) {
    const led = suitOf(g.trick[0].card);
    throw new RuleError(
      g.hands[seat].some((h) => suitOf(h) === led)
        ? `Trebuie să răspunzi la ${SUIT_NAME[led]}.`
        : "Nu ai culoarea cerută: trebuie să tai cu atu.",
    );
  }

  const n = g.seats.length;
  const hands = g.hands.map((h, i) => (i === seat ? h.filter((x) => x !== c) : h));
  const trick = [...g.trick, { seat, card: c }];

  if (trick.length < n) return { ...g, hands, trick, turn: (seat + 1) % n };

  // Trick complete.
  const winner = trickWinner(trick, trumpOf(g));
  const tricks = g.tricks.map((t, i) => (i === winner ? t + 1 : t));
  let next: GameState = { ...g, hands, tricks, trick: [], turn: winner, lastTrick: { plays: trick, winner } };
  if (hands[0].length > 0) return next;

  // Hand complete: score it, then deal the next one or finish the game.
  next = scoreHand(next);
  if (next.handIndex + 1 >= next.sizes.length) {
    return { ...next, phase: "over", hands: next.hands.map(() => []) };
  }
  const lastTrick = next.lastTrick;
  return { ...deal({ ...next, handIndex: next.handIndex + 1 }, random), lastTrick };
}

/** Seats with the highest score (more than one on a tie). */
export function leaders(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const top = Math.max(...scores);
  return scores.flatMap((s, i) => (s === top ? [i] : []));
}
