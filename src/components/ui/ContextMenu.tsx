import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type MenuItem =
  | { separator: true }
  | {
      label: string;
      /** Secondary dim line under the label (e.g. parent path). */
      hint?: string;
      onClick?: () => void;
      disabled?: boolean;
      danger?: boolean;
      shortcut?: string;
      checked?: boolean;
      submenu?: MenuItem[];
    };

export const sep: MenuItem = { separator: true };

type Open = { x: number; y: number; items: MenuItem[] } | null;
let setOpenGlobal: (o: Open) => void = () => {};

/** Show a context menu at the mouse position. */
export function showContextMenu(e: React.MouseEvent | MouseEvent, items: MenuItem[]) {
  e.preventDefault();
  e.stopPropagation();
  setOpenGlobal({ x: e.clientX, y: e.clientY, items });
}

/** Show a menu below an element (toolbar dropdowns). */
export function showMenuAt(el: HTMLElement, items: MenuItem[]) {
  const r = el.getBoundingClientRect();
  setOpenGlobal({ x: r.left, y: r.bottom + 2, items });
}

export function MenuList({ items, onDone }: { items: MenuItem[]; onDone: () => void }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div className="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        "separator" in it ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={`menu-item${it.disabled ? " disabled" : ""}${it.danger ? " danger" : ""}`}
            onMouseEnter={() => setSub(it.submenu ? i : null)}
            onClick={(e) => {
              e.stopPropagation();
              if (it.disabled || it.submenu) return;
              onDone();
              it.onClick?.();
            }}
          >
            <span className="menu-check">{it.checked ? "✓" : ""}</span>
            {it.hint ? (
              <span className="menu-label menu-label-2">
                <span>{it.label}</span>
                <span className="menu-hint" title={it.hint}>{"\u200e" + it.hint + "\u200e"}</span>
              </span>
            ) : (
              <span className="menu-label">{it.label}</span>
            )}
            {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
            {it.submenu && <span className="menu-arrow">▸</span>}
            {it.submenu && sub === i && !it.disabled && (
              <div className="submenu">
                <MenuList items={it.submenu} onDone={onDone} />
              </div>
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function ContextMenuHost() {
  const [open, setOpen] = useState<Open>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  setOpenGlobal = setOpen;

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.max(4, Math.min(open.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(open.y, window.innerHeight - r.height - 4)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: pos.x || open.x, top: pos.y || open.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <MenuList items={open.items} onDone={() => setOpen(null)} />
    </div>
  );
}
