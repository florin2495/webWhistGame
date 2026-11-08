// Table layout: the viewer is always at the bottom, play order runs clockwise starting at their left.
// `rel` = how many seats after the viewer (1 = next to play). The viewer (rel 0) is drawn under the grid.

export interface TableLayout {
  /** CSS grid-template-areas rows; "c" is the middle of the table. */
  rows: string[];
  columns: number;
  /** Grid area name by relative seat (index 0 unused: the viewer is not in the grid). */
  areas: string[];
}

export function tableLayout(n: number): TableLayout {
  switch (n) {
    case 3: // next on the left, last on the right
      return { rows: ["a1 c a2"], columns: 3, areas: ["me", "a1", "a2"] };
    case 4: // left, top, right
      return { rows: [". a2 .", "a1 c a3"], columns: 3, areas: ["me", "a1", "a2", "a3"] };
    case 5: // left, two on top (left to right), right
      return { rows: [". a2 a3 .", "a1 c c a4"], columns: 4, areas: ["me", "a1", "a2", "a3", "a4"] };
    case 6: // two stacked on the left (next is the lower one), one on top, two stacked on the right (last is the lower one)
      return { rows: ["a2 a3 a4", "a1 c a5"], columns: 3, areas: ["me", "a1", "a2", "a3", "a4", "a5"] };
    default:
      throw new Error(`No table layout for ${n} players`);
  }
}

/** Relative seat of `seat` seen from `viewer` (a spectator, viewer = null, sees seat 0 at the bottom). */
export const relativeSeat = (seat: number, viewer: number | null, n: number) => (seat - (viewer ?? 0) + n) % n;
