import { describe, expect, it, vi } from "vitest";
import { isTestRoom, playerKey } from "./leaderboard";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: () => ({}) }));

describe("isTestRoom", () => {
  it("is true only for rooms named e2e-test-…", () => {
    expect(isTestRoom("e2e-test-abc")).toBe(true);
    expect(isTestRoom("e2e-test-ui-x1")).toBe(true);
    expect(isTestRoom("e2e-test-multi-5")).toBe(true);
    expect(isTestRoom("Masa lui Florin")).toBe(false);
    expect(isTestRoom("e2e")).toBe(false);
    expect(isTestRoom("my e2e-test-room")).toBe(false);
  });
});

describe("playerKey", () => {
  it("trims, lowercases and caps at 40 chars", () => {
    expect(playerKey("  Ana ")).toBe("ana");
    expect(playerKey("x".repeat(50))).toHaveLength(40);
  });
});
