import { useState } from "react";
import { FolderGit2, FolderOpen, FolderPlus, DownloadCloud, X, Pin, PinOff } from "lucide-react";
import { basename } from "../lib/format";

export interface RecentRepo {
  path: string;
  pinned?: boolean;
}

const KEY = "gitbench.recent2";

export function loadRecent(): RecentRepo[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (Array.isArray(v)) return v;
    // Migrate the v0.1 list of plain paths.
    const old = JSON.parse(localStorage.getItem("gitbench.recent") || "[]");
    return Array.isArray(old) ? old.map((path: string) => ({ path })) : [];
  } catch {
    return [];
  }
}

export function saveRecent(list: RecentRepo[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30)));
  } catch {
    /* ignore */
  }
}

export function touchRecent(path: string) {
  const list = loadRecent();
  const existing = list.find((r) => r.path === path);
  saveRecent([{ path, pinned: existing?.pinned }, ...list.filter((r) => r.path !== path)]);
}

interface Props {
  onOpen: (path: string) => void;
  onBrowse: () => void;
  onClone: () => void;
  onInit: () => void;
  error: string;
}

export function Dashboard({ onOpen, onBrowse, onClone, onInit, error }: Props) {
  const [recent, setRecent] = useState(loadRecent);
  const update = (list: RecentRepo[]) => {
    saveRecent(list);
    setRecent(list);
  };
  const pinned = recent.filter((r) => r.pinned);
  const others = recent.filter((r) => !r.pinned);

  const item = (r: RecentRepo) => (
    <li key={r.path} onClick={() => onOpen(r.path)} title={r.path}>
      <FolderGit2 size={18} className="icon" />
      <div className="repo-text">
        <b>{basename(r.path)}</b>
        <span>{r.path}</span>
      </div>
      <button
        className="icon-btn"
        title={r.pinned ? "Unpin" : "Pin to top"}
        onClick={(e) => {
          e.stopPropagation();
          update(recent.map((x) => (x.path === r.path ? { ...x, pinned: !x.pinned } : x)));
        }}
      >
        {r.pinned ? <PinOff size={14} /> : <Pin size={14} />}
      </button>
      <button
        className="icon-btn"
        title="Remove from list"
        onClick={(e) => {
          e.stopPropagation();
          update(recent.filter((x) => x.path !== r.path));
        }}
      >
        <X size={14} />
      </button>
    </li>
  );

  return (
    <div className="dashboard">
      <aside className="dash-side">
        <h1>gitbench</h1>
        <p className="muted">Git GUI for Windows, macOS and Linux</p>
        <h4>Common actions</h4>
        <button className="dash-action" onClick={onBrowse}>
          <FolderOpen size={18} /> Open repository…
        </button>
        <button className="dash-action" onClick={onClone}>
          <DownloadCloud size={18} /> Clone repository…
        </button>
        <button className="dash-action" onClick={onInit}>
          <FolderPlus size={18} /> Create new repository…
        </button>
        {error && <p className="error">{error}</p>}
      </aside>
      <main className="dash-main">
        {pinned.length > 0 && (
          <>
            <h3>Pinned</h3>
            <ul className="repo-list">{pinned.map(item)}</ul>
          </>
        )}
        <h3>Recent repositories</h3>
        <ul className="repo-list">{others.map(item)}</ul>
        {!recent.length && <p className="muted">No recent repositories. Open or clone one to get started.</p>}
      </main>
    </div>
  );
}
