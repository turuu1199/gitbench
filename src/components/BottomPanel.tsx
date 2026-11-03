import { useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, BlameLine, ChangedFile, CommitInfo } from "../api";
import { basename, copyText, errorText, formatDate, relativeDate, splitArgs } from "../lib/format";
import { INDEX, useRepo, WORKTREE } from "../repo";
import { DiffView, FileView } from "./DiffView";
import { showContextMenu } from "./ui/ContextMenu";
import { Splitter, useSplit } from "./ui/Splitter";
import { ErrorBoundary } from "./ui/ErrorBoundary";

type Tab = "commit" | "diff" | "tree" | "console";

export function StatusBadge({ s }: { s: string }) {
  const map: Record<string, string> = { M: "M", A: "+", D: "−", R: "R", C: "C", U: "!", "?": "+", T: "T" };
  return <span className={`badge s-${s === "?" ? "N" : s}`}>{map[s] ?? s}</span>;
}

export function BottomPanel() {
  const { selected } = useRepo();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem("gitbench.tab") as Tab) || "commit";
    } catch {
      return "commit";
    }
  });
  const choose = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem("gitbench.tab", t);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    const show = () => choose("console");
    window.addEventListener("gitbench:console", show);
    return () => window.removeEventListener("gitbench:console", show);
  });
  const tabs: [Tab, string][] = [
    ["commit", "Commit"],
    ["diff", selected.length > 1 ? "Diff (compare)" : "Diff"],
    ["tree", "File tree"],
    ["console", "Console"],
  ];
  return (
    <div className="bottom">
      <div className="tabs">
        {tabs.map(([t, label]) => (
          <button key={t} className={`tab${tab === t ? " active" : ""}`} onClick={() => choose(t)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        <ErrorBoundary resetKey={tab + selected.join()}>
          {tab === "commit" && <CommitTab />}
          {tab === "diff" && <DiffTab />}
          {tab === "tree" && <FileTreeTab />}
          {tab === "console" && <ConsoleTab />}
        </ErrorBoundary>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Commit tab

function useCommitInfo(hash: string | undefined) {
  const { data } = useRepo();
  const [info, setInfo] = useState<CommitInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setInfo(null);
    setError("");
    if (!hash || hash === WORKTREE || hash === INDEX) return;
    let alive = true;
    api
      .commitInfo(data.info.root, hash)
      .then((i) => alive && setInfo(i))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [data.info.root, hash]);
  return { info, error };
}

function CommitTab() {
  const { data, actions, selected } = useRepo();
  const hash = selected[0];
  const { info, error } = useCommitInfo(hash);

  if (hash === WORKTREE || hash === INDEX) {
    const files = data.status.filter((f) => (hash === WORKTREE ? f.worktree !== " " : f.index !== " " && f.index !== "?"));
    return (
      <div className="commit-info">
        <h3>{hash === WORKTREE ? "Working directory" : "Commit index"}</h3>
        <p className="muted">
          {files.length} {hash === WORKTREE ? "unstaged" : "staged"} file{files.length === 1 ? "" : "s"}.{" "}
          <a onClick={actions.openCommitDialog}>Open commit dialog</a>
        </p>
      </div>
    );
  }
  if (error) return <div className="empty error">{error}</div>;
  if (!info) return <div className="empty">{hash ? "Loading…" : "Select a commit"}</div>;
  const [subject, ...body] = info.message.split("\n");
  return (
    <div className="commit-info">
      <table className="kv">
        <tbody>
          <tr>
            <th>Author</th>
            <td>
              {info.author} &lt;{info.author_email}&gt;
            </td>
          </tr>
          <tr>
            <th>Date</th>
            <td>
              {relativeDate(info.author_time)} ({formatDate(info.author_time)})
            </td>
          </tr>
          {(info.committer !== info.author || info.commit_time !== info.author_time) && (
            <tr>
              <th>Committer</th>
              <td>
                {info.committer} &lt;{info.committer_email}&gt; · {formatDate(info.commit_time)}
              </td>
            </tr>
          )}
          <tr>
            <th>Commit hash</th>
            <td className="mono">
              {info.hash}{" "}
              <a className="small" onClick={() => copyText(info.hash)}>
                copy
              </a>
            </td>
          </tr>
          <tr>
            <th>Parent{info.parents.length > 1 ? "s" : ""}</th>
            <td className="mono">
              {info.parents.map((p) => (
                <a key={p} onClick={() => actions.select(p)}>
                  {p.slice(0, 10)}{" "}
                </a>
              ))}
            </td>
          </tr>
        </tbody>
      </table>
      <div className="message">
        <b>{subject}</b>
        {body.join("\n").trim() && <pre>{body.join("\n").trim()}</pre>}
      </div>
      {info.branches.length > 0 && (
        <p className="contained">
          <span className="muted">Contained in branches: </span>
          {info.branches.map((b) => (
            <span key={b} className={`ref ${data.branches.some((x) => x.remote && x.name === b) ? "ref-remote" : "ref-branch"}`}>
              {b}
            </span>
          ))}
        </p>
      )}
      {info.tags.length > 0 && (
        <p className="contained">
          <span className="muted">Contained in tags: </span>
          {info.tags.map((t) => (
            <span key={t} className="ref ref-tag">
              {t}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Diff tab

interface DiffSource {
  /** Target revision (or WORKTREE / INDEX). */
  hash: string;
  /** Base to diff against; null = root commit. */
  base: string | null;
  label: string;
}

function useDiffSource(): DiffSource | null {
  const { data, selected } = useRepo();
  const { info } = useCommitInfo(selected.length === 1 ? selected[0] : undefined);
  if (!selected.length) return null;
  if (selected.length > 1) {
    const [a, b] = selected;
    if ([a, b].some((x) => x === WORKTREE || x === INDEX)) return null;
    return { hash: b, base: a, label: `${a.slice(0, 8)} → ${b.slice(0, 8)}` };
  }
  const h = selected[0];
  if (h === WORKTREE || h === INDEX) return { hash: h, base: null, label: "" };
  const fromList = data.commits.find((c) => c.hash === h);
  const parents = fromList?.parents ?? info?.parents;
  if (!parents) return null;
  return { hash: h, base: parents[0] ?? null, label: "" };
}

function DiffTab() {
  const { data, actions } = useRepo();
  const src = useDiffSource();
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [file, setFile] = useState<ChangedFile | null>(null);
  const [diff, setDiff] = useState("");
  const [mode, setMode] = useState<"diff" | "blame" | "file">("diff");
  const [listW, onSplit] = useSplit("difflist", 280, "x", 120);
  const root = data.info.root;
  const isWork = src?.hash === WORKTREE || src?.hash === INDEX;

  // Load changed files.
  useEffect(() => {
    if (!src) return setFiles([]);
    if (src.hash === WORKTREE || src.hash === INDEX) {
      const wt = src.hash === WORKTREE;
      setFiles(
        data.status
          .filter((f) => (wt ? f.worktree !== " " : f.index !== " " && f.index !== "?"))
          .map((f) => ({ path: f.path, orig_path: f.orig_path, status: wt ? f.worktree : f.index })),
      );
      return;
    }
    let alive = true;
    api
      .commitFiles(root, src.hash, src.base)
      .then((f) => alive && setFiles(f))
      .catch(() => alive && setFiles([]));
    return () => {
      alive = false;
    };
  }, [root, src?.hash, src?.base, data.status]); // eslint-disable-line

  // Keep the selected file if it is still in the list.
  useEffect(() => {
    setFile((cur) => files.find((f) => f.path === cur?.path) ?? files[0] ?? null);
  }, [files]);

  useEffect(() => {
    setDiff("");
    if (!src || !file) return;
    let alive = true;
    const p =
      src.hash === WORKTREE
        ? api.diffFile(root, file.path, false, file.status === "?")
        : src.hash === INDEX
          ? api.diffFile(root, file.path, true, false)
          : api.diffCommitFile(root, src.hash, src.base, file.path, file.orig_path);
    p.then((d) => alive && setDiff(d)).catch((e) => alive && setDiff(errorText(e)));
    return () => {
      alive = false;
    };
  }, [root, src?.hash, src?.base, file]); // eslint-disable-line

  if (!src) return <div className="empty">Select a commit (Ctrl/⌘+click a second one to compare)</div>;
  const rev = isWork ? null : src.hash;

  return (
    <div className="split-h">
      <div className="file-list-pane" style={{ width: listW }}>
        {src.label && <div className="compare-label">Comparing {src.label}</div>}
        <ul className="file-list">
          {files.map((f) => (
            <li
              key={f.path}
              className={file?.path === f.path ? "active" : ""}
              onClick={() => setFile(f)}
              title={f.orig_path ? `${f.orig_path} → ${f.path}` : f.path}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: "File history", onClick: () => actions.openFileHistory(f.path) },
                  {
                    label: "Blame",
                    disabled: f.status === "D" || f.status === "?",
                    onClick: () => {
                      setFile(f);
                      setMode("blame");
                    },
                  },
                  { label: "Copy path", onClick: () => copyText(f.path) },
                  { label: "Show in folder", disabled: f.status === "D", onClick: () => revealItemInDir(`${root}/${f.path}`) },
                ])
              }
            >
              <StatusBadge s={f.status} />
              <span className="fname">{basename(f.path)}</span>
              <span className="fdir">{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
            </li>
          ))}
          {!files.length && <li className="muted">No changed files</li>}
        </ul>
      </div>
      <Splitter dir="x" onMouseDown={onSplit} />
      <div className="viewer">
        <div className="viewer-bar">
          <span className="viewer-path">{file?.path}</span>
          <div className="seg">
            {(["diff", "blame", "file"] as const).map((m) => (
              <button key={m} className={mode === m ? "on" : ""} onClick={() => setMode(m)} disabled={!file || (m !== "diff" && file.status === "D")}>
                {m === "diff" ? "Diff" : m === "blame" ? "Blame" : "View"}
              </button>
            ))}
          </div>
        </div>
        <div className="viewer-body">
          {file && mode === "diff" && <DiffView text={diff} />}
          {file && mode === "blame" && <BlameView path={file.path} rev={rev} />}
          {file && mode === "file" && <FileContent path={file.path} rev={rev ?? (src.hash === INDEX ? "" : null)} />}
          {!file && <div className="empty">No file selected</div>}
        </div>
      </div>
    </div>
  );
}

/** File content at a revision. rev=null → working tree (HEAD fallback); rev="" → index. */
export function FileContent({ path, rev }: { path: string; rev: string | null }) {
  const { data } = useRepo();
  const [text, setText] = useState("");
  useEffect(() => {
    let alive = true;
    setText("");
    const spec = rev === null ? "HEAD" : rev;
    // For the working tree we read the committed version when the file is
    // unchanged; changed files are best inspected in the Diff view.
    api
      .fileAt(data.info.root, spec, path)
      .then((t) => alive && setText(t))
      .catch((e) => alive && setText(errorText(e)));
    return () => {
      alive = false;
    };
  }, [data.info.root, path, rev]);
  return <FileView text={text} />;
}

export function BlameView({ path, rev }: { path: string; rev: string | null }) {
  const { data, actions } = useRepo();
  const [lines, setLines] = useState<BlameLine[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setLines(null);
    setError("");
    api
      .blame(data.info.root, path, rev)
      .then((l) => alive && setLines(l))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [data.info.root, path, rev]);
  if (error) return <div className="empty error">{error}</div>;
  if (!lines) return <div className="empty">Loading blame…</div>;
  return (
    <div className="diff blame">
      {lines.map((l, i) => {
        const first = i === 0 || lines[i - 1].hash !== l.hash;
        return (
          <div key={i} className={`dl ctx${first ? " blame-start" : ""}`}>
            <span className="blame-meta" title={l.summary} onClick={() => actions.select(l.hash)}>
              {first ? (
                <>
                  <span className="mono">{l.hash.startsWith("0000000") ? "uncommitted" : l.hash.slice(0, 8)}</span> {l.author} ·{" "}
                  {new Date(l.time * 1000).toLocaleDateString()}
                </>
              ) : (
                ""
              )}
            </span>
            <span className="ln">{i + 1}</span>
            <span className="code">{l.line || " "}</span>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------- File tree tab

interface Dir {
  dirs: Map<string, Dir>;
  files: string[];
}

function FileTreeTab() {
  const { data, actions, selected } = useRepo();
  const h = selected[0];
  const rev = !h || h === WORKTREE || h === INDEX ? data.info.head_hash : h;
  const [paths, setPaths] = useState<string[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<string | null>(null);
  const [mode, setMode] = useState<"file" | "blame">("file");
  const [filter, setFilter] = useState("");
  const [listW, onSplit] = useSplit("treelist", 300, "x", 120);

  useEffect(() => {
    if (!rev) return setPaths([]);
    let alive = true;
    api
      .lsTree(data.info.root, rev)
      .then((p) => alive && setPaths(p))
      .catch(() => alive && setPaths([]));
    return () => {
      alive = false;
    };
  }, [data.info.root, rev]);

  const tree = useMemo(() => {
    const root: Dir = { dirs: new Map(), files: [] };
    const f = filter.toLowerCase();
    for (const p of paths) {
      if (f && !p.toLowerCase().includes(f)) continue;
      const parts = p.split("/");
      let d = root;
      for (const part of parts.slice(0, -1)) {
        if (!d.dirs.has(part)) d.dirs.set(part, { dirs: new Map(), files: [] });
        d = d.dirs.get(part)!;
      }
      d.files.push(p);
    }
    return root;
  }, [paths, filter]);

  const render = (d: Dir, prefix: string, depth: number): React.ReactNode[] => [
    ...[...d.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([name, sub]) => {
        const key = prefix + name + "/";
        const isOpen = open.has(key) || !!filter;
        return [
          <li
            key={key}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() =>
              setOpen((s) => {
                const n = new Set(s);
                if (n.has(key)) n.delete(key);
                else n.add(key);
                return n;
              })
            }
          >
            <span className="twisty">{isOpen ? "▾" : "▸"}</span> {name}
          </li>,
          ...(isOpen ? render(sub, key, depth + 1) : []),
        ];
      }),
    ...d.files.map((p) => (
      <li
        key={p}
        className={file === p ? "active" : ""}
        style={{ paddingLeft: 22 + depth * 14 }}
        onClick={() => setFile(p)}
        onContextMenu={(e) =>
          showContextMenu(e, [
            { label: "File history", onClick: () => actions.openFileHistory(p) },
            { label: "Blame", onClick: () => (setFile(p), setMode("blame")) },
            { label: "Copy path", onClick: () => copyText(p) },
            { label: "Show in folder", onClick: () => revealItemInDir(`${data.info.root}/${p}`) },
          ])
        }
      >
        {basename(p)}
      </li>
    )),
  ];

  if (!rev) return <div className="empty">No commits yet</div>;
  return (
    <div className="split-h">
      <div className="file-list-pane" style={{ width: listW }}>
        <input className="tree-filter" placeholder="Filter files…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <ul className="file-list tree-list">{render(tree, "", 0)}</ul>
      </div>
      <Splitter dir="x" onMouseDown={onSplit} />
      <div className="viewer">
        <div className="viewer-bar">
          <span className="viewer-path">{file}</span>
          <div className="seg">
            <button className={mode === "file" ? "on" : ""} onClick={() => setMode("file")}>
              View
            </button>
            <button className={mode === "blame" ? "on" : ""} onClick={() => setMode("blame")}>
              Blame
            </button>
          </div>
        </div>
        <div className="viewer-body">
          {!file && <div className="empty">Select a file</div>}
          {file && mode === "file" && <FileContent path={file} rev={rev} />}
          {file && mode === "blame" && <BlameView path={file} rev={rev} />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Console tab

interface Entry {
  cmd: string;
  out: string;
  ok: boolean;
}

let consoleLog: Entry[] = [];
let consoleHistory: string[] = [];

function ConsoleTab() {
  const { data, actions } = useRepo();
  const [entries, setEntries] = useState<Entry[]>(consoleLog);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState(false);
  const hist = useRef(-1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [entries]);

  const runLine = async () => {
    const cmd = line.trim();
    if (!cmd) return;
    const args = splitArgs(cmd.replace(/^git\s+/, ""));
    consoleHistory = [cmd, ...consoleHistory.filter((c) => c !== cmd)].slice(0, 50);
    hist.current = -1;
    setLine("");
    setBusy(true);
    let entry: Entry;
    try {
      entry = { cmd, out: await api.git(data.info.root, args), ok: true };
    } catch (e) {
      entry = { cmd, out: errorText(e), ok: false };
    }
    consoleLog = [...consoleLog, entry].slice(-200);
    setEntries(consoleLog);
    setBusy(false);
    actions.refresh();
  };

  return (
    <div className="console">
      <div className="console-out">
        {entries.map((e, i) => (
          <div key={i}>
            <div className="console-cmd">$ git {e.cmd.replace(/^git\s+/, "")}</div>
            <pre className={e.ok ? "" : "error"}>{e.out}</pre>
          </div>
        ))}
        {!entries.length && <div className="muted">Run any git command in {data.info.root}. Example: status, log --oneline -5</div>}
        <div ref={endRef} />
      </div>
      <div className="console-in">
        <span className="mono">git</span>
        <input
          className="mono"
          value={line}
          disabled={busy}
          placeholder="status"
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") runLine();
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              hist.current = Math.max(-1, Math.min(consoleHistory.length - 1, hist.current + (e.key === "ArrowUp" ? 1 : -1)));
              setLine(hist.current < 0 ? "" : consoleHistory[hist.current]);
            }
          }}
        />
        <button onClick={() => (consoleLog = [], setEntries([]))}>Clear</button>
      </div>
    </div>
  );
}
