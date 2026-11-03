import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api, Commit } from "../api";
import { errorText, formatDate } from "../lib/format";
import { useRepo } from "../repo";
import { BlameView, FileContent } from "./BottomPanel";
import { DiffView } from "./DiffView";
import { Splitter, useSplit } from "./ui/Splitter";

export function FileHistory({ path, onClose }: { path: string; onClose: () => void }) {
  const { data, actions } = useRepo();
  const [commits, setCommits] = useState<Commit[] | null>(null);
  const [sel, setSel] = useState<Commit | null>(null);
  const [mode, setMode] = useState<"diff" | "blame" | "file">("diff");
  const [diff, setDiff] = useState("");
  const [error, setError] = useState("");
  const [topH, onSplit] = useSplit("history.top", 260, "y", 100);

  useEffect(() => {
    api
      .log(data.info.root, { path, limit: 2000, all: false })
      .then((c) => {
        setCommits(c);
        setSel(c[0] ?? null);
      })
      .catch((e) => setError(errorText(e)));
  }, [data.info.root, path]);

  useEffect(() => {
    if (!sel) return setDiff("");
    let alive = true;
    // Only this commit's change to the path.
    api
      .git(data.info.root, ["show", "--format=", "--patch", "-M", sel.hash, "--", path])
      .then((d) => alive && setDiff(d))
      .catch((e) => alive && setDiff(errorText(e)));
    return () => {
      alive = false;
    };
  }, [data.info.root, sel, path]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <div className="window history-window">
        <header className="window-title">
          <span>
            File history — <b>{path}</b>
          </span>
          <button className="icon-btn" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className="history-list" style={{ height: topH }}>
          {error && <div className="empty error">{error}</div>}
          {!commits && !error && <div className="empty">Loading…</div>}
          <table className="simple-table">
            <tbody>
              {commits?.map((c) => (
                <tr
                  key={c.hash}
                  className={sel?.hash === c.hash ? "active" : ""}
                  onClick={() => setSel(c)}
                  onDoubleClick={() => {
                    actions.select(c.hash);
                    onClose();
                  }}
                  title="Double-click to show in the revision grid"
                >
                  <td className="msg">{c.subject}</td>
                  <td>{c.author}</td>
                  <td>{formatDate(c.time)}</td>
                  <td className="mono">{c.short}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Splitter dir="y" onMouseDown={onSplit} />
        <div className="viewer">
          <div className="viewer-bar">
            <span className="viewer-path">{sel ? `${sel.short} ${sel.subject}` : ""}</span>
            <div className="seg">
              {(["diff", "blame", "file"] as const).map((m) => (
                <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)}>
                  {m === "diff" ? "Diff" : m === "blame" ? "Blame" : "View"}
                </button>
              ))}
            </div>
          </div>
          <div className="viewer-body">
            {sel && mode === "diff" && <DiffView text={diff} />}
            {sel && mode === "blame" && <BlameView path={path} rev={sel.hash} />}
            {sel && mode === "file" && <FileContent path={path} rev={sel.hash} />}
          </div>
        </div>
      </div>
    </div>
  );
}
