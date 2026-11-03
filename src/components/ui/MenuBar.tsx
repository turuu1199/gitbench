import { useEffect, useState } from "react";
import { MenuItem, MenuList } from "./ContextMenu";

export interface TopMenu {
  label: string;
  items: MenuItem[];
}

/** Classic application menu bar (click to open, hover to switch). */
export function MenuBar({ menus }: { menus: TopMenu[] }) {
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const close = () => setOpen(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  return (
    <nav className="menubar" onMouseDown={(e) => e.stopPropagation()}>
      {menus.map((m, i) => (
        <div
          key={m.label}
          className={`menubar-item${open === i ? " open" : ""}`}
          onMouseDown={() => setOpen(open === i ? null : i)}
          onMouseEnter={() => open !== null && setOpen(i)}
        >
          {m.label}
          {open === i && (
            <div className="menubar-drop" onMouseDown={(e) => e.stopPropagation()}>
              <MenuList items={m.items} onDone={() => setOpen(null)} />
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}
