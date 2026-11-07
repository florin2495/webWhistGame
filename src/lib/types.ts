import type { Card, HandResult, Play, Settings, Suit } from "./whist";

export type RoomStatus = "lobby" | "playing" | "finished";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  /** Milliseconds the player still has to press "Ignoră" on a pending kick; null = no pending kick. */
  kickRemainingMs: number | null;
  /** Seen in the last 45 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
}

/** What a member sees of the running game. Other players' cards are never included. */
export interface PublicGame {
  names: string[];
  /** Player id by seat. */
  seats: string[];
  /** My seat, or null if I am not seated in this game. */
  mySeat: number | null;
  sizes: number[];
  handIndex: number;
  handSize: number;
  phase: "bidding" | "playing" | "over";
  trumpCard: Card | null;
  trump: Suit | null;
  dealer: number;
  bids: (number | null)[];
  tricks: number[];
  turn: number;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: number } | null;
  scores: number[];
  streaks: number[];
  history: HandResult[];
  /** Cards still in each player's hand. */
  cardsLeft: number[];
  myHand: Card[];
  /** Cards I may play now (empty when it is not my turn to play). */
  legal: Card[];
  /** Bids I may make now (empty when it is not my turn to bid). */
  allowedBids: number[];
  /** Nickname of the player whose leaving stopped the game. */
  abortedBy: string | null;
  /** Winning seats once the game is over (several on a tie, none if stopped early). */
  winners: number[];
}

/** What GET /api/rooms/[code]/state returns to a member. */
export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    status: RoomStatus;
    round: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
    settings: Settings;
  };
  /** Seat order while a game exists, join order in the lobby. */
  players: PublicPlayer[];
  me: PublicPlayer;
  game: PublicGame | null;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  hasPassword: boolean;
  players: number;
  settings: Settings;
}

export interface Session {
  playerId: string;
  token: string;
}
