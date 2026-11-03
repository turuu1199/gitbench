/**
 * Helpers to parse a unified diff and build a partial patch containing only
 * selected lines, so single lines/hunks can be staged, unstaged or reset with
 * `git apply --recount`.
 */

export type LineKind = "file" | "hunk" | "add" | "del" | "ctx" | "meta" | "nonl";

export interface DiffLine {
  kind: LineKind;
  text: string;
  /** Index of the hunk this line belongs to (-1 for file header lines). */
  hunk: number;
  oldNo?: number;
  newNo?: number;
}

export function parseDiff(text: string): DiffLine[] {
  const out: DiffLine[] = [];
  let hunk = -1;
  let oldNo = 0;
  let newNo = 0;
  let inHeader = true;
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const t of lines) {
    if (t.startsWith("diff --git") || t.startsWith("diff --cc") || t.startsWith("diff --combined")) {
      inHeader = true;
      out.push({ kind: "file", text: t, hunk: -1 });
      continue;
    }
    if (t.startsWith("@@")) {
      inHeader = false;
      hunk++;
      // Combined diffs ("@@@ -a -b +c @@@") list several old ranges; use the first old and the new one.
      const m = /^@@+ -(\d+)[^+]*\+(\d+)/.exec(t);
      oldNo = m ? +m[1] : 0;
      newNo = m ? +m[2] : 0;
      out.push({ kind: "hunk", text: t, hunk });
      continue;
    }
    if (inHeader) {
      out.push({ kind: "meta", text: t, hunk: -1 });
    } else if (t.startsWith("+")) {
      out.push({ kind: "add", text: t, hunk, newNo: newNo++ });
    } else if (t.startsWith("-")) {
      out.push({ kind: "del", text: t, hunk, oldNo: oldNo++ });
    } else if (t.startsWith("\\")) {
      out.push({ kind: "nonl", text: t, hunk });
    } else {
      out.push({ kind: "ctx", text: t, hunk, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return out;
}

interface BlockLine {
  kind: "add" | "del";
  text: string;
  selected: boolean;
  /** Trailing "\ No newline at end of file" marker, if any. */
  nonl?: string;
}

/**
 * Turn one change block (consecutive -/+ lines) into patch lines.
 *
 * Staging (reverse=false), the patch applies to the old side:
 *   unselected "-" lines stay as context, unselected "+" lines are dropped,
 *   selected "+" lines go right after the first selected "-" line (so a
 *   partial "-a -b +A" stages as "A b", not "b A").
 * Unstaging / resetting (reverse=true), the patch is applied with --reverse
 * so the new side must match: unselected "+" lines stay as context,
 * unselected "-" lines are dropped, selected "-" lines go right before the
 * first selected "+" line.
 */
function emitBlock(block: BlockLine[], reverse: boolean, out: string[]) {
  const push = (l: BlockLine, asCtx: boolean) => {
    out.push(asCtx ? " " + l.text.slice(1) : l.text);
    if (l.nonl) out.push(l.nonl);
  };
  const keepSide = reverse ? "add" : "del";
  const moveSide = reverse ? "del" : "add";
  const kept = block.filter((l) => l.kind === keepSide);
  const moved = block.filter((l) => l.kind === moveSide && l.selected);
  const anchor = kept.findIndex((l) => l.selected);
  const emitMoved = () => moved.forEach((l) => push(l, false));

  if (anchor === -1) {
    // Nothing selected on the kept side: moved lines go at the block edge.
    if (reverse) emitMoved();
    kept.forEach((l) => push(l, true));
    if (!reverse) emitMoved();
    return;
  }
  kept.forEach((l, i) => {
    if (reverse && i === anchor) emitMoved();
    push(l, !l.selected);
    if (!reverse && i === anchor) emitMoved();
  });
}

/**
 * Build a patch with only the selected +/- lines (see emitBlock for the
 * rules). Returns null when no change lines are selected. Hunk counts are
 * left as-is; callers apply with `git apply --recount`.
 */
export function buildPartialPatch(lines: DiffLine[], selected: Set<number>, reverse: boolean): string | null {
  const header: string[] = [];
  const hunks: { lines: string[]; changed: boolean }[] = [];
  let block: BlockLine[] = [];
  let lastCtx = false;

  const flush = () => {
    if (block.length && hunks.length) emitBlock(block, reverse, hunks[hunks.length - 1].lines);
    block = [];
  };

  lines.forEach((l, i) => {
    switch (l.kind) {
      case "file":
      case "meta":
        if (l.kind === "file" || l.text.startsWith("---") || l.text.startsWith("+++") || /^(new|deleted) file mode|^(old|new) mode/.test(l.text))
          header.push(l.text);
        return;
      case "hunk":
        flush();
        hunks.push({ lines: [l.text], changed: false });
        lastCtx = false;
        return;
      case "ctx":
        flush();
        hunks[hunks.length - 1]?.lines.push(l.text);
        lastCtx = true;
        return;
      case "add":
      case "del":
        block.push({ kind: l.kind, text: l.text, selected: selected.has(i) });
        if (selected.has(i) && hunks.length) hunks[hunks.length - 1].changed = true;
        lastCtx = false;
        return;
      case "nonl":
        if (block.length) block[block.length - 1].nonl = l.text;
        else if (lastCtx) hunks[hunks.length - 1]?.lines.push(l.text);
        return;
    }
  });
  flush();

  const changed = hunks.filter((h) => h.changed);
  if (!changed.length) return null;
  return [...header, ...changed.flatMap((h) => h.lines)].join("\n") + "\n";
}

/** Indices of all change lines in a hunk. */
export function hunkLineIndices(lines: DiffLine[], hunk: number): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (l.hunk === hunk && (l.kind === "add" || l.kind === "del")) out.push(i);
  });
  return out;
}
