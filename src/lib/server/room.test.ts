import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROOM_ABANDONED_MS, ROOM_ABANDONED_PLAYING_MS } from "@/lib/whist";
import { cleanupAbandonedRooms } from "./room";

// cleanupAbandonedRooms with the Supabase client mocked: every query is recorded, selects return `mock.rows`.
// vi.mock / vi.hoisted are hoisted above the imports.
vi.mock("server-only", () => ({}));

type Call = { op: string; args: unknown[] };

const mock = vi.hoisted(() => {
  const m = {
    rows: [] as Record<string, unknown>[],
    selectError: null as unknown,
    deleteError: null as unknown,
    throwOnFrom: false,
    deletes: [] as Call[][],
    builder() {
      const calls: Call[] = [];
      const b: Record<string, unknown> = {};
      for (const op of ["select", "lt", "limit", "delete", "in", "neq", "eq"]) {
        b[op] = (...args: unknown[]) => {
          calls.push({ op, args });
          return b;
        };
      }
      b.then = (resolve: (v: unknown) => void) => {
        if (calls.some((c) => c.op === "delete")) {
          m.deletes.push(calls);
          resolve({ error: m.deleteError });
        } else resolve({ data: m.rows, error: m.selectError });
      };
      return b;
    },
  };
  return m;
});

vi.mock("./db", () => ({
  T: { rooms: "whist_rooms", players: "whist_players" },
  db: () => ({
    from: () => {
      if (mock.throwOnFrom) throw new Error("network down");
      return mock.builder();
    },
  }),
}));

const NOW = Date.parse("2026-11-15T12:00:00Z");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const room = (id: string, status: string, idleS: number, seen: (number | null)[]) => ({
  id,
  status,
  last_activity_at: ago(idleS),
  members: seen.map((s) => ({ last_seen_at: s === null ? null : ago(s) })),
});
const arg = (calls: Call[], op: string) => calls.find((c) => c.op === op)?.args;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock.rows = [];
  mock.selectError = null;
  mock.deleteError = null;
  mock.throwOnFrom = false;
  mock.deletes = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("cleanupAbandonedRooms", () => {
  it("keeps a silent room while a member was seen recently", async () => {
    mock.rows = [room("a", "lobby", 700, [700, 30])];
    await cleanupAbandonedRooms();
    expect(mock.deletes).toHaveLength(0);
  });

  it("deletes lobby / finished rooms nobody was seen in, re-checking status and cutoff in the delete", async () => {
    mock.rows = [room("a", "lobby", 700, [700, null]), room("b", "finished", 601, []), room("c", "lobby", 700, [10])];
    await cleanupAbandonedRooms();
    expect(mock.deletes).toHaveLength(1);
    const d = mock.deletes[0];
    expect(arg(d, "in")).toEqual(["id", ["a", "b"]]);
    expect(arg(d, "neq")).toEqual(["status", "playing"]);
    expect(arg(d, "lt")).toEqual(["last_activity_at", new Date(NOW - ROOM_ABANDONED_MS).toISOString()]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("keeps a running game for up to 6 hours of silence", async () => {
    mock.rows = [room("p", "playing", 3600, [3600]), room("q", "playing", 6 * 3600 - 60, [])];
    await cleanupAbandonedRooms();
    expect(mock.deletes).toHaveLength(0);
  });

  it("deletes a running game silent for more than 6 hours, with the 6-hour cutoff", async () => {
    mock.rows = [room("p", "playing", 6 * 3600 + 60, [6 * 3600 + 60])];
    await cleanupAbandonedRooms();
    expect(mock.deletes).toHaveLength(1);
    const d = mock.deletes[0];
    expect(arg(d, "in")).toEqual(["id", ["p"]]);
    expect(arg(d, "eq")).toEqual(["status", "playing"]);
    expect(arg(d, "lt")).toEqual(["last_activity_at", new Date(NOW - ROOM_ABANDONED_PLAYING_MS).toISOString()]);
  });

  it("logs a select error and does not throw", async () => {
    mock.selectError = { message: "boom" };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
    expect(mock.deletes).toHaveLength(0);
  });

  it("logs a delete error and does not throw", async () => {
    mock.rows = [room("a", "lobby", 700, [])];
    mock.deleteError = { message: "boom" };
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("logs a thrown DB error and does not throw", async () => {
    mock.throwOnFrom = true;
    await expect(cleanupAbandonedRooms()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});
