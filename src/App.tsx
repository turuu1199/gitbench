import { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, Branch, Commit, RepoInfo } from "./api";
import { Diff } from "./components/Diff";
import { CommitDialog } from "./components/CommitDialog";
import "./App.css";

const RECENT_KEY = "gitbench.recent";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveRecent(path: string) {
  const list = [path, ...loadRecent().filter((p) => p !== path)].slice(0, 10);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function formatDate(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

function RefLabel({ name }: { name: string }) {
  let cls = "ref";
  let label = name;
  if (name.startsWith("HEAD -> ")) {
    cls += " ref-head";
    label = name.slice(8);
  } else if (name.startsWith("tag: ")) {
    cls += " ref-tag";
    label = name.slice(5);
  } else if (name.includes("/")) {
    cls += " ref-remote";
  }
  return <span className={cls}>{label}</span>;
}

export default function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selected, setSelected] = useState<Commit | null>(null);
  const [detail, setDetail] = useState("");
  const [changes, setChanges] = useState(0);
  const [showCommit, setShowCommit] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [recent, setRecent] = useState<string[]>(loadRecent);

  const refresh = useCallback(async (root: string) => {
    try {
      const [info, log, br, st] = await Promise.all([
        api.openRepo(root),
        api.log(root),
        api.branches(root),
        api.status(root),
      ]);
      setRepo(info);
      setCommits(log);
      setBranches(br);
      setChanges(st.length);
    } catch (e) {
      setStatus(String(e));
    }
  }, []);

  const openPath = async (path: string) => {
    try {
      const info = await api.openRepo(path);
      saveRecent(info.root);
      setRecent(loadRecent());
      setSelected(null);
      setDetail("");
      setStatus("");
      await refresh(info.root);
    } catch (e) {
      setStatus(String(e));
    }
  };

  const browse = async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") openPath(dir);
  };

  useEffect(() => {
    if (!repo || !selected) return;
    api.showCommit(repo.root, selected.hash).then(setDetail).catch((e) => setDetail(String(e)));
  }, [repo, selected]);

  const runOp = async (label: string, fn: () => Promise<string | void>) => {
    if (!repo) return;
    setBusy(true);
    setStatus(`${label}…`);
    try {
      const out = await fn();
      setStatus(`${label} done${out ? ": " + out.trim().split("\n").pop() : ""}`);
    } catch (e) {
      setStatus(`${label} failed: ${e}`);
    } finally {
      setBusy(false);
      refresh(repo.root);
    }
  };

  const [branchName, setBranchName] = useState<string | null>(null);
  const createBranch = () => {
    const name = branchName?.trim();
    setBranchName(null);
    if (repo && name) runOp("Create branch", () => api.createBranch(repo.root, name));
  };

  if (!repo) {
    return (
      <main className="welcome">
        <h1>gitbench</h1>
        <p>Cross-platform Git GUI</p>
        <button className="primary" onClick={browse}>
          Open repository…
        </button>
        {recent.length > 0 && (
          <>
            <h3>Recent</h3>
            <ul className="recent">
              {recent.map((r) => (
                <li key={r} onClick={() => openPath(r)}>
                  {r}
                </li>
              ))}
            </ul>
          </>
        )}
        {status && <p className="error">{status}</p>}
      </main>
    );
  }

  const local = branches.filter((b) => !b.remote);
  const remote = branches.filter((b) => b.remote);
  const q = filter.toLowerCase();
  const shown = q
    ? commits.filter(
        (c) =>
          c.subject.toLowerCase().includes(q) ||
          c.author.toLowerCase().includes(q) ||
          c.hash.startsWith(q),
      )
    : commits;

  return (
    <div className="app">
      <div className="toolbar">
        <button onClick={browse} title="Open repository">📂 Open</button>
        <button onClick={() => refresh(repo.root)} disabled={busy}>⟳ Refresh</button>
        <span className="sep" />
        <button onClick={() => setShowCommit(true)} disabled={busy}>
          ✔ Commit{changes ? ` (${changes})` : ""}
        </button>
        <button onClick={() => runOp("Fetch", () => api.remoteOp(repo.root, "fetch"))} disabled={busy}>
          ⇣ Fetch
        </button>
        <button onClick={() => runOp("Pull", () => api.remoteOp(repo.root, "pull"))} disabled={busy}>
          ⤓ Pull
        </button>
        <button onClick={() => runOp("Push", () => api.remoteOp(repo.root, "push"))} disabled={busy}>
          ⤒ Push
        </button>
        {branchName === null ? (
          <button onClick={() => setBranchName("")} disabled={busy}>⑂ Branch</button>
        ) : (
          <input
            autoFocus
            placeholder="New branch name, Enter"
            value={branchName}
            onChange={(e) => setBranchName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createBranch();
              if (e.key === "Escape") setBranchName(null);
            }}
            onBlur={() => setBranchName(null)}
          />
        )}
        <span className="sep" />
        <input
          className="filter"
          placeholder="Filter commits…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="repo-name" title={repo.root}>
          {repo.root.split(/[\\/]/).pop()} · <b>{repo.head}</b>
        </span>
      </div>

      <div className="main">
        <aside className="sidebar">
          <h4>Branches</h4>
          <ul>
            {local.map((b) => (
              <li
                key={b.name}
                className={b.current ? "current" : ""}
                onDoubleClick={() => runOp(`Checkout ${b.name}`, () => api.checkout(repo.root, b.name))}
                title="Double-click to checkout"
              >
                {b.current ? "● " : ""}
                {b.name}
                {b.track && <span className="track">{b.track}</span>}
              </li>
            ))}
          </ul>
          <h4>Remotes</h4>
          <ul>
            {remote.map((b) => (
              <li key={b.name} className="remote">{b.name}</li>
            ))}
          </ul>
        </aside>

        <section className="content">
          <div className="log">
            <table>
              <thead>
                <tr>
                  <th>Message</th>
                  <th>Author</th>
                  <th>Date</th>
                  <th>Hash</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr
                    key={c.hash}
                    className={selected?.hash === c.hash ? "active" : ""}
                    onClick={() => setSelected(c)}
                  >
                    <td className="subject">
                      {c.refs.map((r) => (
                        <RefLabel key={r} name={r} />
                      ))}
                      {c.subject}
                    </td>
                    <td>{c.author}</td>
                    <td>{formatDate(c.time)}</td>
                    <td className="mono">{c.short}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!commits.length && <div className="empty">No commits yet</div>}
          </div>
          <div className="detail">
            {selected ? <Diff text={detail} /> : <div className="empty">Select a commit</div>}
          </div>
        </section>
      </div>

      <footer className="statusbar">{status || repo.root}</footer>

      {showCommit && (
        <CommitDialog
          repo={repo.root}
          onClose={(committed) => {
            setShowCommit(false);
            if (committed) setStatus("Committed");
            refresh(repo.root);
          }}
        />
      )}
    </div>
  );
}
