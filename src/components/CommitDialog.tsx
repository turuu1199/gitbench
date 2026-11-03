import { useCallback, useEffect, useState } from "react";
import { api, FileChange } from "../api";
import { Diff } from "./Diff";

interface Props {
  repo: string;
  onClose: (committed: boolean) => void;
}

interface Selected {
  path: string;
  staged: boolean;
  untracked: boolean;
}

export function CommitDialog({ repo, onClose }: Props) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [diff, setDiff] = useState("");
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setFiles(await api.status(repo));
    } catch (e) {
      setError(String(e));
    }
  }, [repo]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) return setDiff("");
    api
      .diffFile(repo, selected.path, selected.staged, selected.untracked)
      .then(setDiff)
      .catch((e) => setDiff(String(e)));
  }, [repo, selected, files]);

  const unstaged = files.filter((f) => f.worktree !== " ");
  const staged = files.filter((f) => f.index !== " " && f.index !== "?");

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const doCommit = () =>
    run(async () => {
      await api.commit(repo, message, amend);
      onClose(true);
    });

  const fileRow = (f: FileChange, isStaged: boolean) => {
    const code = isStaged ? f.index : f.worktree;
    const untracked = f.worktree === "?";
    const active =
      selected?.path === f.path && selected.staged === isStaged;
    return (
      <li
        key={(isStaged ? "s:" : "u:") + f.path}
        className={active ? "active" : ""}
        onClick={() => setSelected({ path: f.path, staged: isStaged, untracked })}
        onDoubleClick={() =>
          run(async () => {
            await (isStaged ? api.unstage : api.stage)(repo, [f.path]);
            // Follow the file to the other list so the diff pane stays relevant.
            setSelected({ path: f.path, staged: !isStaged, untracked: isStaged && f.index === "A" });
          })
        }
        title="Double-click to stage / unstage"
      >
        <span className={`badge s-${code === "?" ? "U" : code}`}>{code === "?" ? "+" : code}</span>
        {f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}
      </li>
    );
  };

  return (
    <div className="modal-backdrop">
      <div className="modal commit-dialog">
        <header>
          <h2>Commit</h2>
          <button onClick={() => onClose(false)}>✕</button>
        </header>
        <div className="commit-body">
          <div className="commit-lists">
            <section>
              <div className="section-head">
                Unstaged ({unstaged.length})
                <button
                  disabled={busy || !unstaged.length}
                  onClick={() => run(() => api.stage(repo, unstaged.map((f) => f.path)))}
                >
                  Stage all ↓
                </button>
              </div>
              <ul className="file-list">{unstaged.map((f) => fileRow(f, false))}</ul>
            </section>
            <section>
              <div className="section-head">
                Staged ({staged.length})
                <button
                  disabled={busy || !staged.length}
                  onClick={() => run(() => api.unstage(repo, staged.map((f) => f.path)))}
                >
                  Unstage all ↑
                </button>
              </div>
              <ul className="file-list">{staged.map((f) => fileRow(f, true))}</ul>
            </section>
          </div>
          <div className="commit-right">
            <div className="diff-pane">
              <Diff text={diff} />
            </div>
            <div className="message-box">
              <textarea
                placeholder="Commit message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && message.trim())
                    doCommit();
                }}
              />
              <div className="commit-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={amend}
                    onChange={(e) => setAmend(e.target.checked)}
                  />
                  Amend last commit
                </label>
                {error && <span className="error">{error}</span>}
                <button
                  className="primary"
                  disabled={busy || !message.trim() || (!staged.length && !amend)}
                  onClick={doCommit}
                >
                  Commit (Ctrl/⌘+Enter)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
