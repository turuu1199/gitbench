import type { Commit } from "../api";

/** One row of the revision graph. */
export interface GraphRow {
  /** Lane of this commit's dot. */
  lane: number;
  /** Lanes entering from above (hash expected in each lane, or null). */
  before: (string | null)[];
  /** Lanes leaving below. */
  after: (string | null)[];
}

/**
 * Assign each commit (in topological order, newest first) a lane and record
 * which lanes pass through each row so the renderer can draw edges.
 */
export function computeGraph(commits: Commit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const c of commits) {
    let lane = lanes.indexOf(c.hash);
    const isTip = lane === -1;
    if (isTip) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
      lanes[lane] = c.hash;
    }
    const before = lanes.slice();
    // A branch tip has nothing coming in from above.
    if (isTip) before[lane] = null;

    // Other lanes that were waiting for this commit merge into it here.
    for (let i = 0; i < lanes.length; i++) if (i !== lane && lanes[i] === c.hash) lanes[i] = null;

    const [first, ...rest] = c.parents;
    lanes[lane] = first ?? null;
    for (const p of rest) {
      if (lanes.includes(p)) continue;
      const free = lanes.indexOf(null);
      if (free === -1) lanes.push(p);
      else lanes[free] = p;
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();

    rows.push({ lane, before, after: lanes.slice() });
  }
  return rows;
}

export const LANE_W = 14;
export const ROW_H = 22;

const COLORS = ["#3b82f6", "#16a34a", "#e11d48", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];
export const laneColor = (i: number) => COLORS[i % COLORS.length];

export function graphWidth(rows: GraphRow[]) {
  let max = 1;
  for (const r of rows) max = Math.max(max, r.before.length, r.after.length, r.lane + 1);
  return Math.min(max, 24) * LANE_W + 6;
}
