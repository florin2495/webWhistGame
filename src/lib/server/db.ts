import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { GameState, Settings } from "@/lib/whist";

/**
 * Table names. The Supabase project is shared by every hailatat.icu mini-game,
 * so every Whist object carries the whist_ prefix.
 */
export const T = {
  rooms: "whist_rooms",
  players: "whist_players",
} as const;

let admin: SupabaseClient | null = null;

/** Service-role client. Bypasses RLS - must never be imported from client code. */
export function db(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Game state as stored in whist_rooms.game: the pure state plus the nicknames at deal time. */
export type StoredGame = GameState & { names: string[] };

export interface RoomRow {
  id: string;
  code: string;
  name: string;
  password_hash: string | null;
  status: "lobby" | "playing" | "finished";
  round: number;
  host_player_id: string | null;
  settings: Settings;
  game: StoredGame | null;
  version: number;
  last_activity_at: string;
}

export const ROOM_COLUMNS =
  "id, code, name, password_hash, status, round, host_player_id, settings, game, version, last_activity_at";

export interface PlayerRow {
  id: string;
  room_id: string;
  nickname: string;
  is_host: boolean;
  joined_at: string;
  /** Pending kick during a game (null = none). Needs migration 001_pending_kick.sql. */
  kick_requested_at: string | null;
  /** Presence stamp, touched by requireMember. Needs migration 002_reconnect.sql. */
  last_seen_at: string;
}

/** Never add token_hash / device_hash here: these rows feed the public state. */
export const PLAYER_COLUMNS = "id, room_id, nickname, is_host, joined_at, kick_requested_at, last_seen_at";
