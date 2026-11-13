/** Parsing and rebuilding of files that contain git conflict markers. */

export interface TextSeg {
  kind: "text";
  text: string;
}

export interface ConflictSeg {
  kind: "conflict";
  ours: string;
  /** Common ancestor; only present with merge.conflictStyle=diff3/zdiff3. */
  base: string | null;
  theirs: string;
  oursLabel: string;
  baseLabel: string;
  theirsLabel: string;
}

export type Segment = TextSeg | ConflictSeg;
export type Choice = "ours" | "theirs" | "ours-theirs" | "theirs-ours" | "base" | "none";

const marker = (line: string, ch: string) => {
  const body = line.replace(/\r?\n$/, "");
  if (!body.startsWith(ch.repeat(7))) return null;
  const rest = body.slice(7);
  if (ch === "=") return rest === "" ? "" : null;
  if (rest === "") return "";
  return rest[0] === " " ? rest.slice(1) : null;
};

/** Split into lines, keeping each line's terminator. */
function lines(text: string): string[] {
  const out = text.match(/[^\n]*\n|[^\n]+$/g);
  return out ?? [];
}

export function parseConflicts(text: string): Segment[] {
  const segs: Segment[] = [];
  const ls = lines(text);
  let plain = "";
  let i = 0;
  const flush = () => {
    if (plain) segs.push({ kind: "text", text: plain });
    plain = "";
  };
  while (i < ls.length) {
    const start = marker(ls[i], "<");
    if (start === null) {
      plain += ls[i++];
      continue;
    }
    // Scan the block; if it is malformed treat its first line as plain text.
    const c: ConflictSeg = { kind: "conflict", ours: "", base: null, theirs: "", oursLabel: start, baseLabel: "", theirsLabel: "" };
    let part: "ours" | "base" | "theirs" = "ours";
    let j = i + 1;
    let done = false;
    for (; j < ls.length; j++) {
      const l = ls[j];
      let m: string | null;
      if (part === "ours" && (m = marker(l, "|")) !== null) {
        part = "base";
        c.base = "";
        c.baseLabel = m;
      } else if (part !== "theirs" && marker(l, "=") !== null) {
        part = "theirs";
      } else if (part === "theirs" && (m = marker(l, ">")) !== null) {
        c.theirsLabel = m;
        done = true;
        break;
      } else if (marker(l, "<") !== null) {
        break; // nested / malformed
      } else if (part === "ours") c.ours += l;
      else if (part === "base") c.base += l;
      else c.theirs += l;
    }
    if (!done) {
      plain += ls[i++];
      continue;
    }
    flush();
    segs.push(c);
    i = j + 1;
  }
  flush();
  return segs;
}

export function resolveSeg(c: ConflictSeg, choice: Choice): string {
  switch (choice) {
    case "ours":
      return c.ours;
    case "theirs":
      return c.theirs;
    case "ours-theirs":
      return c.ours + c.theirs;
    case "theirs-ours":
      return c.theirs + c.ours;
    case "base":
      return c.base ?? "";
    case "none":
      return "";
  }
}

/** Re-emit a conflict with its markers (for unresolved blocks). */
export function markers(c: ConflictSeg): string {
  const lbl = (s: string) => (s ? " " + s : "");
  const nl = (s: string) => (s && !s.endsWith("\n") ? s + "\n" : s);
  return (
    `<<<<<<<${lbl(c.oursLabel)}\n` +
    nl(c.ours) +
    (c.base !== null ? `|||||||${lbl(c.baseLabel)}\n` + nl(c.base) : "") +
    "=======\n" +
    nl(c.theirs) +
    `>>>>>>>${lbl(c.theirsLabel)}\n`
  );
}

/** Build the file text; conflicts without a choice keep their markers. */
export function buildResult(segs: Segment[], choices: (Choice | undefined)[]): string {
  let n = 0;
  return segs
    .map((s) => {
      if (s.kind === "text") return s.text;
      const ch = choices[n++];
      return ch ? resolveSeg(s, ch) : markers(s);
    })
    .join("");
}

export const hasMarkers = (text: string) => parseConflicts(text).some((s) => s.kind === "conflict");
