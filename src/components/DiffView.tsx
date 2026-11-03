import { useEffect, useMemo, useRef, useState } from "react";
import { buildPartialPatch, DiffLine, hunkLineIndices, parseDiff } from "../lib/patch";
import { showContextMenu, MenuItem } from "./ui/ContextMenu";

export interface LineAction {
  label: string;
  key: string;
  /** Build patch reversed (for unstage / reset). */
  reverse: boolean;
  danger?: boolean;
  run: (patch: string) => void;
}

interface Props {
  text: string;
  /** When given, lines can be selected and these actions applied to them. */
  lineActions?: LineAction[];
  empty?: string;
}

/** Unified diff viewer with optional line/hunk selection for partial staging. */
export function DiffView({ text, lineActions, empty = "No changes" }: Props) {
  const lines = useMemo(() => parseDiff(text), [text]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const anchor = useRef<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const selectable = !!lineActions?.length;

  useEffect(() => {
    setSel(new Set());
    anchor.current = null;
  }, [text]);

  const isChange = (l: DiffLine) => l.kind === "add" || l.kind === "del";

  const clickLine = (i: number, e: React.MouseEvent) => {
    if (!selectable || !isChange(lines[i])) return;
    const next = new Set(e.metaKey || e.ctrlKey ? sel : []);
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)];
      for (let k = a; k <= b; k++) if (isChange(lines[k])) next.add(k);
    } else if ((e.metaKey || e.ctrlKey) && sel.has(i)) {
      next.delete(i);
    } else {
      next.add(i);
      anchor.current = i;
    }
    setSel(next);
  };

  const apply = (a: LineAction, indices: Set<number>) => {
    const patch = buildPartialPatch(lines, indices, a.reverse);
    if (patch) a.run(patch);
  };

  const menu = (e: React.MouseEvent, hunk?: number) => {
    if (!selectable) return;
    const items: MenuItem[] = [];
    if (sel.size)
      for (const a of lineActions!)
        items.push({ label: `${a.label} selected line(s)`, shortcut: a.key, danger: a.danger, onClick: () => apply(a, sel) });
    if (hunk !== undefined && hunk >= 0) {
      const all = new Set(hunkLineIndices(lines, hunk));
      for (const a of lineActions!) items.push({ label: `${a.label} hunk`, danger: a.danger, onClick: () => apply(a, all) });
    }
    if (items.length) showContextMenu(e, items);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!selectable || !sel.size || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = lineActions!.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (a) {
      e.preventDefault();
      e.stopPropagation();
      apply(a, sel);
    }
  };

  if (!text.trim()) return <div className="empty">{empty}</div>;
  if (/^Binary files .* differ$/m.test(text) && lines.every((l) => l.kind !== "add" && l.kind !== "del"))
    return <div className="empty">Binary file changed</div>;

  return (
    <div className="diff" tabIndex={0} ref={boxRef} onKeyDown={onKey}>
      {lines.map((l, i) => {
        if (l.kind === "hunk")
          return (
            <div key={i} className="dl hunk" onContextMenu={(e) => menu(e, l.hunk)}>
              <span className="ln" />
              <span className="ln" />
              <span className="code">{l.text}</span>
              {selectable && (
                <span className="hunk-actions">
                  {lineActions!.map((a) => (
                    <button
                      key={a.label}
                      className={a.danger ? "danger" : ""}
                      onClick={() => apply(a, new Set(hunkLineIndices(lines, l.hunk)))}
                    >
                      {a.label} hunk
                    </button>
                  ))}
                </span>
              )}
            </div>
          );
        if (l.kind === "file" || l.kind === "meta")
          return (
            <div key={i} className={`dl ${l.kind}`}>
              <span className="code">{l.text}</span>
            </div>
          );
        return (
          <div
            key={i}
            className={`dl ${l.kind}${sel.has(i) ? " selected" : ""}${selectable && isChange(l) ? " pickable" : ""}`}
            onMouseDown={(e) => {
              if (e.button === 0) clickLine(i, e);
            }}
            onContextMenu={(e) => {
              if (isChange(l) && !sel.has(i)) {
                const s = new Set([i]);
                setSel(s);
                anchor.current = i;
                // Use fresh selection for the menu.
                const items: MenuItem[] = lineActions?.map((a) => ({
                  label: `${a.label} selected line(s)`,
                  shortcut: a.key,
                  danger: a.danger,
                  onClick: () => apply(a, s),
                })) ?? [];
                const all = new Set(hunkLineIndices(lines, l.hunk));
                lineActions?.forEach((a) => items.push({ label: `${a.label} hunk`, danger: a.danger, onClick: () => apply(a, all) }));
                if (items.length) showContextMenu(e, items);
              } else menu(e, l.hunk);
            }}
          >
            <span className="ln">{l.oldNo ?? ""}</span>
            <span className="ln">{l.newNo ?? ""}</span>
            <span className="code">{l.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Plain file viewer with line numbers. */
export function FileView({ text }: { text: string }) {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return (
    <div className="diff">
      {lines.map((l, i) => (
        <div key={i} className="dl ctx">
          <span className="ln">{i + 1}</span>
          <span className="code">{l || " "}</span>
        </div>
      ))}
    </div>
  );
}
