import { useCallback, useState } from "react";

function load(key: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem("gitbench.split." + key));
    return v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** A size (px) persisted per key, plus a drag handler for a splitter bar. */
export function useSplit(key: string, initial: number, dir: "x" | "y", min = 80, invert = false) {
  const [size, setSize] = useState(() => load(key, initial));

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const start = dir === "x" ? e.clientX : e.clientY;
      const startSize = size;
      let last = size;
      const move = (ev: MouseEvent) => {
        const delta = (dir === "x" ? ev.clientX : ev.clientY) - start;
        last = Math.max(min, startSize + (invert ? -delta : delta));
        setSize(last);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.classList.remove("resizing-x", "resizing-y");
        try {
          localStorage.setItem("gitbench.split." + key, String(last));
        } catch {
          /* ignore */
        }
      };
      document.body.classList.add(dir === "x" ? "resizing-x" : "resizing-y");
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [dir, invert, key, min, size],
  );

  return [size, onMouseDown] as const;
}

export function Splitter({ dir, onMouseDown }: { dir: "x" | "y"; onMouseDown: (e: React.MouseEvent) => void }) {
  return <div className={`splitter splitter-${dir}`} onMouseDown={onMouseDown} />;
}
