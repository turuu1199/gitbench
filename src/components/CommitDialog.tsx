import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, RotateCcw, X } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, FileChange, isConflict, ops } from "../api";
import { basename, copyText, errorText } from "../lib/format";
import { useRepo } from "../repo";
import { StatusBadge } from "./BottomPanel";
import { DiffView, LineAction } from "./DiffView";
import { MenuItem, sep, showContextMenu } from "./ui/ContextMenu";
import { ask, confirm } from "./ui/Dialogs";
import { Splitter, useSplit } from "./ui/Splitter";

interface Props {
  onClose: (committed?: string) => void;
}

type ListKind = "unstaged" | "staged";

const DRAFT_KEY = "gitbench.draft.";

export function CommitDialog({ onClose }: Props) {
  const { data, actions } = useRepo();
  const root = data.info.root;
  const [files, setFiles] = useState<FileChange[]>(data.status);
  const [sel, setSel] = useState<{ list: ListKind; paths: Set<string> }>({ list: "unstaged", paths: new Set() });
  const anchor = useRef<string | null>(null);
  const [diff, setDiff] = useState("");
  const [message, setMessage] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY + root) ?? "";
    } catch {
      return "";
    }
  });
  const [amend, setAmend] = useState(false);
  const [resetAuthor, setResetAuthor] = useState(false);
  const [noVerify, setNoVerify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [who, setWho] = useState("");
  const [leftW, onSplitX] = useSplit("commit.left", 360, "x", 200);
  const [msgH, onSplitY] = useSplit("commit.msg", 170, "y", 90, true);

  const unstaged = useMemo(() => files.filter((f) => f.worktree !== " " || isConflict(f)), [files]);
  const staged = useMemo(() => files.filter((f) => f.index !== " " && f.index !== "?" && !isConflict(f)), [files]);
  const conflicts = files.filter(isConflict).length;

  const reload = useCallback(async () => {
    try {
      const s = await api.status(root);
      setFiles(s);
    } catch (e) {
      setError(errorText(e));
    }
  }, [root]);

  useEffect(() => {
    reload();
    Promise.all([ops.getConfig(root, "user.name"), ops.getConfig(root, "user.email")]).then(([n, e]) =>
      setWho(n || e ? `${n} <${e}>` : "user.name / user.email not set"),
    );
  }, [reload, root]);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY + root, message);
    } catch {
      /* ignore */
    }
  }, [message, root]);

  // Prune selection to files still in the list; pick first file when empty.
  useEffect(() => {
    setSel((s) => {
      const list = s.list === "unstaged" ? unstaged : staged;
      const paths = new Set([...s.paths].filter((p) => list.some((f) => f.path === p)));
      if (!paths.size) {
        const other = s.list === "unstaged" ? staged : unstaged;
        if (list[0]) return { list: s.list, paths: new Set([list[0].path]) };
        if (other[0]) return { list: s.list === "unstaged" ? "staged" : "unstaged", paths: new Set([other[0].path]) };
      }
      return { list: s.list, paths };
    });
  }, [unstaged, staged]);

  const focusFile = sel.paths.size === 1 ? [...sel.paths][0] : null;
  const focusEntry = focusFile ? files.find((f) => f.path === focusFile) : undefined;

  useEffect(() => {
    if (!focusEntry) return setDiff("");
    let alive = true;
    const untracked = focusEntry.worktree === "?";
    api
      .diffFile(root, focusEntry.path, sel.list === "staged", untracked && sel.list === "unstaged")
      .then((d) => alive && setDiff(d))
      .catch((e) => alive && setDiff(errorText(e)));
    return () => {
      alive = false;
    };
  }, [root, focusEntry, sel.list, files]);

  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const selectedIn = (list: ListKind) => (sel.list === list ? [...sel.paths] : []);

  const stage = (paths: string[]) => paths.length && run(() => ops.stage(root, paths));
  const unstage = (paths: string[]) => paths.length && run(() => ops.unstage(root, paths));
  const resetFiles = async (paths: string[]) => {
    if (!paths.length) return;
    const entries = files.filter((f) => paths.includes(f.path));
    const untracked = entries.filter((f) => f.worktree === "?").map((f) => f.path);
    const tracked = entries.filter((f) => f.worktree !== "?").map((f) => f.path);
    const ok = await confirm(
      "Reset file changes",
      <>
        Discard changes to {paths.length === 1 ? <b>{paths[0]}</b> : `${paths.length} files`}?
        {untracked.length > 0 && <p>Untracked files will be deleted.</p>}
        <p>This cannot be undone.</p>
      </>,
      "Reset",
      true,
    );
    if (ok) run(() => ops.discard(root, tracked, untracked));
  };

  const onRowMouseDown = (list: ListKind, items: FileChange[], f: FileChange, e: React.MouseEvent) => {
    if (e.button !== 0 && sel.list === list && sel.paths.has(f.path)) return;
    const multi = e.metaKey || e.ctrlKey;
    let paths = new Set(multi && sel.list === list ? sel.paths : []);
    if (e.shiftKey && anchor.current && sel.list === list) {
      const a = items.findIndex((x) => x.path === anchor.current);
      const b = items.findIndex((x) => x.path === f.path);
      paths = new Set(items.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.path));
    } else if (multi && paths.has(f.path)) {
      paths.delete(f.path);
    } else {
      paths.add(f.path);
      anchor.current = f.path;
    }
    setSel({ list, paths });
  };

  const fileMenu = (list: ListKind, f: FileChange): MenuItem[] => {
    const paths = sel.list === list && sel.paths.has(f.path) ? [...sel.paths] : [f.path];
    const conflict = isConflict(f);
    const items: MenuItem[] =
      list === "unstaged"
        ? [
            { label: "Stage", shortcut: "S", onClick: () => stage(paths) },
            { label: "Reset file or directory changes…", shortcut: "R", danger: true, onClick: () => resetFiles(paths) },
          ]
        : [{ label: "Unstage", shortcut: "U", onClick: () => unstage(paths) }];
    if (conflict)
      items.push(
        sep,
        { label: "Resolve: use ours (current branch)", onClick: () => run(() => api.git(root, ["checkout", "--ours", "--", ...paths]).then(() => ops.stage(root, paths))) },
        { label: "Resolve: use theirs (incoming)", onClick: () => run(() => api.git(root, ["checkout", "--theirs", "--", ...paths]).then(() => ops.stage(root, paths))) },
        { label: "Mark as resolved", onClick: () => stage(paths) },
      );
    items.push(
      sep,
      { label: "File history", onClick: () => actions.openFileHistory(f.path) },
      { label: "Copy path", onClick: () => copyText(paths.join("\n")) },
      { label: "Show in folder", disabled: f.worktree === "D", onClick: () => revealItemInDir(`${root}/${f.path}`) },
    );
    if (list === "unstaged" && f.worktree === "?")
      items.push({
        label: "Add to .gitignore",
        onClick: async () => {
          const v = await ask({
            title: "Add to .gitignore",
            fields: [{ name: "pattern", label: "Pattern", type: "text", value: "/" + f.path, mono: true, required: true }],
            ok: "Add",
          });
          if (v) run(() => api.appendGitignore(root, String(v.pattern)));
        },
      });
    return items;
  };

  const onListKey = (list: ListKind) => (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const paths = selectedIn(list);
    const k = e.key.toLowerCase();
    if (list === "unstaged" && k === "s") stage(paths);
    else if (list === "unstaged" && k === "r") resetFiles(paths);
    else if (list === "staged" && k === "u") unstage(paths);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = list === "unstaged" ? unstaged : staged;
      const i = items.findIndex((f) => f.path === (focusFile ?? anchor.current));
      const n = items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
      if (n) {
        anchor.current = n.path;
        setSel({ list, paths: new Set([n.path]) });
      }
    } else return;
    e.preventDefault();
  };

  const lineActions: LineAction[] =
    !focusEntry || focusEntry.worktree === "?" || isConflict(focusEntry)
      ? []
      : sel.list === "unstaged"
        ? [
            { label: "Stage", key: "S", reverse: false, run: (p) => run(() => ops.applyPatch(root, p, { cached: true })) },
            {
              label: "Reset",
              key: "R",
              reverse: true,
              danger: true,
              run: async (p) => {
                if (await confirm("Reset lines", "Discard the selected changes from the working directory? This cannot be undone.", "Reset", true))
                  run(() => ops.applyPatch(root, p, { reverse: true }));
              },
            },
          ]
        : [{ label: "Unstage", key: "U", reverse: true, run: (p) => run(() => ops.applyPatch(root, p, { cached: true, reverse: true })) }];

  const toggleAmend = async (on: boolean) => {
    setAmend(on);
    if (on && !message.trim()) {
      const last = await ops.lastMessage(root).catch(() => "");
      setMessage(last.trim());
    }
  };

  const doCommit = async (andPush: boolean) => {
    if (!message.trim()) return setError("Enter a commit message");
    if (conflicts) return setError("Resolve all conflicts first");
    if (!staged.length && !amend) {
      if (!unstaged.length) return setError("Nothing to commit");
      const ok = await confirm("Nothing staged", "There are no staged changes. Stage all changes and commit?", "Stage all and commit");
      if (!ok) return;
      await ops.stage(root, ["."]).catch((e) => setError(errorText(e)));
    }
    setBusy(true);
    setError("");
    try {
      await ops.commit(root, message.trim(), { amend, resetAuthor: amend && resetAuthor, noVerify });
      setMessage("");
      try {
        localStorage.removeItem(DRAFT_KEY + root);
      } catch {
        /* ignore */
      }
      onClose(amend ? "Amended last commit" : "Committed");
      if (andPush) actions.push(false);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
      reload();
    }
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".dialog")) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const fileRow = (list: ListKind, items: FileChange[], f: FileChange) => {
    const code = isConflict(f) ? "U" : list === "staged" ? f.index : f.worktree;
    const active = sel.list === list && sel.paths.has(f.path);
    return (
      <li
        key={f.path}
        className={active ? "active" : ""}
        onMouseDown={(e) => onRowMouseDown(list, items, f, e)}
        onDoubleClick={() => (list === "unstaged" ? stage([f.path]) : unstage([f.path]))}
        onContextMenu={(e) => {
          if (!active) setSel({ list, paths: new Set([f.path]) });
          showContextMenu(e, fileMenu(list, f));
        }}
        title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}
      >
        <StatusBadge s={code} />
        <span className="fname">{basename(f.path)}</span>
        <span className="fdir">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
      </li>
    );
  };

  return (
    <div className="modal-backdrop">
      <div className="window commit-window">
        <header className="window-title">
          <span>
            Commit to <b>{data.info.head}</b> — {basename(root)}
          </span>
          <button className="icon-btn" onClick={() => onClose()} title="Close (Esc)">
            <X size={16} />
          </button>
        </header>
        {conflicts > 0 && (
          <div className="banner warn">
            {conflicts} conflicted file{conflicts > 1 ? "s" : ""}. Right-click to resolve with ours/theirs, or edit and mark as resolved.
          </div>
        )}
        <div className="commit-main">
          <div className="commit-left" style={{ width: leftW }}>
            <div className="list-head">
              <span>Unstaged changes ({unstaged.length})</span>
              <button className="icon-btn" title="Reset selected (R)" disabled={busy || !selectedIn("unstaged").length} onClick={() => resetFiles(selectedIn("unstaged"))}>
                <RotateCcw size={14} />
              </button>
            </div>
            <ul className="file-list" tabIndex={0} onKeyDown={onListKey("unstaged")}>
              {unstaged.map((f) => fileRow("unstaged", unstaged, f))}
              {!unstaged.length && <li className="muted">No unstaged changes</li>}
            </ul>
            <div className="stage-buttons">
              <button disabled={busy || !selectedIn("unstaged").length} onClick={() => stage(selectedIn("unstaged"))} title="Stage selected (S)">
                <ArrowDown size={14} /> Stage
              </button>
              <button disabled={busy || !unstaged.length} onClick={() => stage(unstaged.filter((f) => !isConflict(f)).map((f) => f.path))} title="Stage all">
                <ChevronsDown size={14} /> All
              </button>
              <button disabled={busy || !selectedIn("staged").length} onClick={() => unstage(selectedIn("staged"))} title="Unstage selected (U)">
                <ArrowUp size={14} /> Unstage
              </button>
              <button disabled={busy || !staged.length} onClick={() => run(() => api.git(root, ["reset", "-q"]))} title="Unstage all">
                <ChevronsUp size={14} /> All
              </button>
            </div>
            <div className="list-head">
              <span>Staged changes ({staged.length})</span>
            </div>
            <ul className="file-list" tabIndex={0} onKeyDown={onListKey("staged")}>
              {staged.map((f) => fileRow("staged", staged, f))}
              {!staged.length && <li className="muted">Nothing staged</li>}
            </ul>
          </div>
          <Splitter dir="x" onMouseDown={onSplitX} />
          <div className="commit-right">
            <div className="viewer-bar">
              <span className="viewer-path">
                {focusEntry ? `${sel.list === "staged" ? "Staged" : "Unstaged"}: ${focusEntry.path}` : sel.paths.size > 1 ? `${sel.paths.size} files selected` : ""}
              </span>
              {lineActions.length > 0 && <span className="muted small">Select lines, then press {lineActions.map((a) => a.key).join(" / ")} or right-click</span>}
            </div>
            <div className="viewer-body">
              <DiffView text={diff} lineActions={lineActions} empty={focusEntry ? "No changes" : "Select a file"} />
            </div>
            <Splitter dir="y" onMouseDown={onSplitY} />
            <div className="message-pane" style={{ height: msgH }}>
              <textarea
                placeholder="Commit message (first line is the summary)"
                value={message}
                spellCheck
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doCommit(false);
                }}
              />
              <div className="message-side">
                <button className="primary" disabled={busy} onClick={() => doCommit(false)} title="Ctrl/⌘+Enter">
                  {amend ? "Amend commit" : "Commit"}
                </button>
                <button disabled={busy || !data.remotes.length} onClick={() => doCommit(true)}>
                  {amend ? "Amend & push" : "Commit & push"}
                </button>
                <label className="check">
                  <input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} /> Amend commit
                </label>
                {amend && (
                  <label className="check">
                    <input type="checkbox" checked={resetAuthor} onChange={(e) => setResetAuthor(e.target.checked)} /> Reset author
                  </label>
                )}
                <label className="check">
                  <input type="checkbox" checked={noVerify} onChange={(e) => setNoVerify(e.target.checked)} /> Skip hooks
                </label>
              </div>
            </div>
          </div>
        </div>
        <footer className="window-status">
          <span className="muted">Committing as {who}</span>
          {message && <span className={`muted ${message.split("\n")[0].length > 72 ? "warn-text" : ""}`}>summary {message.split("\n")[0].length}/72</span>}
          {error && <span className="error">{error}</span>}
        </footer>
      </div>
    </div>
  );
}
