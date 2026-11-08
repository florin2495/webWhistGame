import { describe, expect, it } from "vitest";
import { relativeSeat, tableLayout } from "./tableLayout";

describe("table layout", () => {
  it("places every opponent exactly once for 3 to 6 players", () => {
    for (let n = 3; n <= 6; n++) {
      const l = tableLayout(n);
      const named = l.rows.join(" ").split(" ").filter((a) => /^a\d$/.test(a));
      expect(named.sort()).toEqual(Array.from({ length: n - 1 }, (_, i) => `a${i + 1}`));
      expect(l.rows.every((r) => r.split(" ").length === l.columns)).toBe(true);
      expect(l.areas).toHaveLength(n);
    }
  });

  it("has 2 on the left, 1 on top, 2 on the right for 6 players", () => {
    const l = tableLayout(6);
    const col = (c: number) => l.rows.map((r) => r.split(" ")[c]);
    expect(col(0)).toEqual(["a2", "a1"]);
    expect(col(1)).toEqual(["a3", "c"]);
    expect(col(2)).toEqual(["a4", "a5"]);
  });

  it("has 1 left, 2 on top, 1 right for 5 players", () => {
    const l = tableLayout(5);
    expect(l.rows).toEqual([". a2 a3 .", "a1 c c a4"]);
  });

  it("counts seats clockwise from the viewer", () => {
    expect(relativeSeat(2, 2, 5)).toBe(0);
    expect(relativeSeat(3, 2, 5)).toBe(1);
    expect(relativeSeat(1, 2, 5)).toBe(4);
    expect(relativeSeat(0, null, 4)).toBe(0);
  });
});
