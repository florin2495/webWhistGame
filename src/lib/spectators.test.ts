import { describe, expect, it } from "vitest";
import { isPermutation, nextRoundOrder } from "./spectators";

describe("isPermutation", () => {
  it("accepts a reordering and rejects anything else", () => {
    expect(isPermutation(["b", "a", "c"], ["a", "b", "c"])).toBe(true);
    expect(isPermutation(["a", "a", "c"], ["a", "b", "c"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "b", "c"])).toBe(false);
    expect(isPermutation(["a", "b", "x"], ["a", "b", "c"])).toBe(false);
    expect(isPermutation("abc", ["a", "b", "c"])).toBe(false);
    expect(isPermutation([1, 2, 3], ["a", "b", "c"])).toBe(false);
  });
});

describe("nextRoundOrder", () => {
  it("rotates the opener and appends queued spectators while seats are free", () => {
    expect(nextRoundOrder(["a", "b", "c"], ["x", "y"], 4)).toEqual({ order: ["b", "c", "a", "x"], promoted: ["x"] });
    expect(nextRoundOrder(["a", "b", "c", "d"], ["x"], 4)).toEqual({ order: ["b", "c", "d", "a"], promoted: [] });
    expect(nextRoundOrder(["a", "b"], ["x", "y", "z"], 4)).toEqual({ order: ["b", "a", "x", "y"], promoted: ["x", "y"] });
  });
});
