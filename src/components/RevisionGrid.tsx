import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { Commit } from "../api";
import { computeGraph, GraphRow, graphWidth, LANE_W, laneColor, ROW_H } from "../lib/graph";
import { copyText, formatDate } from "../lib/format";
import { INDEX, stripRemote, useRepo, WORKTREE } from "../repo";
import { MenuItem, sep, showContextMenu } from "./ui/ContextMenu";
import { ask } from "./ui/Dialogs";
import { isConflict, ops } from "../api";

const OVERSCAN = 20;

export function RefLabels({ refs, headName }: { refs: string[]; headName?: string }) {
  const { data } = useRepo();
  const remoteNames = data.remotes.map((r) => r.name + "/");
  return (
    <>
      {refs.map((r) => {
        let cls = "ref ref-branch";
        let label = r;
        if (r === "HEAD") {
          cls = "ref ref-head-detached";
        } else if (r.startsWith("HEAD -> ")) {
          cls = "ref ref-branch ref-current";
          label = r.slice(8);
        } else if (r.startsWith("tag: ")) {
          cls = "ref ref-tag";
          label = r.slice(5);
        } else if (r.endsWith("/HEAD")) {
          return null;
        } else if (remoteNames.some((p) => r.startsWith(p))) {
          cls = "ref ref-remote";
        } else if (r.startsWith("refs/stash")) {
          cls = "ref ref-stash";
          label = "stash";
        }
        return (
          <span key={r} className={cls} title={r === headName ? "current branch" : r}>
            {label}
          </span>
        );
      })}
    </>
  );
}

const GraphCell = memo(function GraphCell({
  row,
  commit,
  width,
  isHead,
}: {
  row: GraphRow;
  commit: Commit;
  width: number;
  isHead: boolean;
}) {
  const x = (i: number) => i * LANE_W + LANE_W / 2 + 2;
  const mid = ROW_H / 2;
  const paths: React.ReactNode[] = [];
  row.before.forEach((h, j) => {
    if (h === null) return;
    if (h === commit.hash) {
      // Lane(s) ending in this commit's dot.
      paths.push(<path key={`t${j}`} d={`M${x(j)} 0 C ${x(j)} ${mid / 2}, ${x(row.lane)} ${mid / 2}, ${x(row.lane)} ${mid}`} stroke={laneColor(j)} />);
    } else {
      // Lane passing straight through.
      paths.push(<path key={`p${j}`} d={`M${x(j)} 0 L ${x(j)} ${ROW_H}`} stroke={laneColor(j)} />);
    }
  });
  // Edges from the dot down to each parent's lane.
  commit.parents.forEach((p, n) => {
    // First parent continues in this commit's own lane.
    const k = n === 0 && row.after[row.lane] === p ? row.lane : row.after.indexOf(p);
    if (k < 0) return;
    paths.push(
      <path
        key={`b${n}`}
        d={`M${x(row.lane)} ${mid} C ${x(row.lane)} ${ROW_H}, ${x(k)} ${mid}, ${x(k)} ${ROW_H}`}
        stroke={laneColor(k)}
      />,
    );
  });
  return (
    <svg width={width} height={ROW_H} className="graph">
      <g fill="none" strokeWidth={2}>
        {paths}
      </g>
      <circle
        cx={x(row.lane)}
        cy={mid}
        r={isHead ? 5 : 4}
        fill={isHead ? "var(--bg)" : laneColor(row.lane)}
        stroke={laneColor(row.lane)}
        strokeWidth={2}
      />
    </svg>
  );
});

interface Props {
  filter: string;
  onOpenCommit: () => void;
}

export function RevisionGrid({ filter, onOpenCommit }: Props) {
  const { data, actions, selected } = useRepo();
  const boxRef = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [height, setHeight] = useState(600);
  const [search, setSearch] = useState("");
  const searchTimer = useRef<number>(0);

  const q = filter.trim().toLowerCase();
  const commits = useMemo(
    () =>
      q
        ? data.commits.filter(
            (c) =>
              c.subject.toLowerCase().includes(q) ||
              c.author.toLowerCase().includes(q) ||
              c.email.toLowerCase().includes(q) ||
              c.hash.startsWith(q) ||
              c.refs.some((r) => r.toLowerCase().includes(q)),
          )
        : data.commits,
    [data.commits, q],
  );
  const graph = useMemo(() => (q ? null : computeGraph(commits)), [commits, q]);
  const gWidth = graph ? graphWidth(graph) : 0;

  const unstaged = data.status.filter((f) => f.worktree !== " ").length;
  const staged = data.status.filter((f) => f.index !== " " && f.index !== "?" && !isConflict(f)).length;
  const pseudo = q ? [] : [WORKTREE, INDEX];
  const rowCount = pseudo.length + commits.length;
  const keys = useMemo(() => [...pseudo, ...commits.map((c) => c.hash)], [commits, q]); // eslint-disable-line

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the selected row visible when it changes from outside (go to commit, sidebar).
  const primary = selected[0];
  useEffect(() => {
    const el = boxRef.current;
    const i = keys.indexOf(primary);
    if (!el || i < 0) return;
    const top = i * ROW_H;
    const headerH = ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight - headerH) el.scrollTop = top - el.clientHeight + ROW_H * 2 + headerH;
  }, [primary, keys]);

  const first = Math.max(0, Math.floor(scroll / ROW_H) - OVERSCAN);
  const last = Math.min(rowCount, Math.ceil((scroll + height) / ROW_H) + OVERSCAN);
  const headName = data.info.head;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = keys.indexOf(primary);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, Math.min(keys.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      if (keys[n]) actions.select(keys[n]);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      actions.select(keys[e.key === "Home" ? 0 : keys.length - 1]);
      return;
    }
    if (e.key === "Enter" && primary === WORKTREE) return onOpenCommit();
    // Quick search: type to jump to the next matching commit.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const term = search + e.key.toLowerCase();
      setSearch(term);
      window.clearTimeout(searchTimer.current);
      searchTimer.current = window.setTimeout(() => setSearch(""), 1500);
      const start = Math.max(0, i);
      const idx = commits.findIndex(
        (c, k) => k + pseudo.length >= start && (c.subject.toLowerCase().includes(term) || c.refs.some((r) => r.toLowerCase().includes(term))),
      );
      if (idx >= 0) actions.select(commits[idx].hash);
    }
  };

  const menuFor = (c: Commit): MenuItem[] => {
    const refsHere = c.refs
      .map((r) => r.replace(/^HEAD -> /, ""))
      .filter((r) => r !== "HEAD" && !r.startsWith("tag: ") && !r.endsWith("/HEAD") && !r.startsWith("refs/"));
    const local = refsHere.filter((r) => data.branches.some((b) => !b.remote && b.name === r));
    const remote = refsHere.filter((r) => data.branches.some((b) => b.remote && b.name === r));
    const tagsHere = c.refs.filter((r) => r.startsWith("tag: ")).map((r) => r.slice(5));
    const mergeTargets = [...local, ...remote].filter((b) => b !== headName);
    const isMerge = c.parents.length > 1;
    return [
      { label: "Create new branch here…", shortcut: "Ctrl+B", onClick: () => actions.createBranch(c.hash) },
      {
        label: "Checkout branch",
        disabled: !local.length && !remote.length,
        submenu: [
          ...local.map((b) => ({ label: b, disabled: b === headName, onClick: () => actions.checkoutBranch(b) })),
          ...remote.map((b) => ({ label: b, onClick: () => actions.checkoutRemoteBranch(b) })),
        ],
      },
      { label: "Checkout this commit (detached HEAD)", onClick: () => actions.checkoutRevision(c.hash) },
      {
        label: "Merge into current branch",
        submenu: [
          ...mergeTargets.map((b) => ({ label: b, onClick: () => actions.merge(b) })),
          { label: `Commit ${c.short}`, onClick: () => actions.merge(c.hash) },
        ],
      },
      {
        label: "Rebase current branch on",
        submenu: [
          ...mergeTargets.map((b) => ({ label: b, onClick: () => actions.rebase(b) })),
          { label: `Commit ${c.short}`, onClick: () => actions.rebase(c.hash) },
        ],
      },
      { label: "Reset current branch to here…", onClick: () => actions.reset(c.hash) },
      sep,
      { label: "Create new tag here…", onClick: () => actions.createTag(c.hash) },
      {
        label: "Delete tag",
        disabled: !tagsHere.length,
        submenu: tagsHere.map((t) => ({ label: t, onClick: () => actions.deleteTag(t) })),
      },
      {
        label: "Rename branch",
        disabled: !local.length,
        submenu: local.map((b) => ({ label: b, onClick: () => actions.renameBranch(b) })),
      },
      {
        label: "Delete branch",
        disabled: !local.length && !remote.length,
        submenu: [
          ...local.map((b) => ({ label: b, disabled: b === headName, onClick: () => actions.deleteBranch(b) })),
          ...remote.map((b) => ({ label: b, onClick: () => actions.deleteRemoteBranch(b) })),
        ],
      },
      sep,
      { label: "Cherry pick this commit…", onClick: () => actions.cherryPick(c) },
      { label: isMerge ? "Revert this merge commit…" : "Revert this commit…", onClick: () => actions.revert(c) },
      sep,
      {
        label: "Copy to clipboard",
        submenu: [
          { label: `Commit hash  ${c.short}`, onClick: () => copyText(c.hash) },
          { label: "Short hash", onClick: () => copyText(c.short) },
          { label: "Message", onClick: () => copyText(c.subject) },
          { label: "Author", onClick: () => copyText(`${c.author} <${c.email}>`) },
          { label: "Date", onClick: () => copyText(formatDate(c.time)) },
          ...refsHere.map((r) => ({ label: `Branch  ${r}`, onClick: () => copyText(stripRemote(r, data.remotes)) })),
        ],
      },
    ];
  };

  const worktreeMenu = (): MenuItem[] => [
    { label: "Commit…", shortcut: "Ctrl+Space", onClick: onOpenCommit },
    { label: "Stash changes…", onClick: actions.stash },
    sep,
    {
      label: "Reset all changes…",
      danger: true,
      onClick: async () => {
        const v = await ask({
          title: "Reset all changes",
          message: "This discards all staged and unstaged changes in the working directory. This cannot be undone.",
          fields: [{ name: "clean", label: "Also delete untracked files", type: "checkbox" }],
          ok: "Reset",
          danger: true,
        });
        if (!v) return;
        await actions.run("Reset all changes", async () => {
          await ops.reset(data.info.root, "hard", "HEAD");
          if (v.clean) await ops.discard(data.info.root, [], ["."]);
        });
      },
    },
  ];

  const rows: React.ReactNode[] = [];
  for (let i = first; i < last; i++) {
    const key = keys[i];
    const isSel = selected.includes(key);
    const style = { top: i * ROW_H };
    if (key === WORKTREE || key === INDEX) {
      const isWt = key === WORKTREE;
      const count = isWt ? unstaged : staged;
      rows.push(
        <div
          key={key}
          className={`row pseudo${isSel ? " selected" : ""}`}
          style={style}
          onMouseDown={(e) => actions.select(key, e.metaKey || e.ctrlKey)}
          onDoubleClick={onOpenCommit}
          onContextMenu={(e) => {
            actions.select(key);
            showContextMenu(e, isWt ? worktreeMenu() : [{ label: "Commit…", onClick: onOpenCommit }]);
          }}
        >
          <div className="cell graph-cell" style={{ width: gWidth }}>
            <svg width={gWidth} height={ROW_H} className="graph">
              <circle cx={LANE_W / 2 + 2} cy={ROW_H / 2} r={4} fill="none" stroke="var(--muted)" strokeWidth={2} strokeDasharray="2 2" />
            </svg>
          </div>
          <div className="cell msg">
            <span className={`pseudo-label${count ? " has" : ""}`}>
              {isWt ? "Working directory" : "Commit index"} ({count})
            </span>
          </div>
          <div className="cell author" />
          <div className="cell date" />
          <div className="cell hash" />
        </div>,
      );
      continue;
    }
    const c = commits[i - pseudo.length];
    const isHead = c.hash === data.info.head_hash;
    rows.push(
      <div
        key={c.hash}
        className={`row${isSel ? " selected" : ""}${isHead ? " head" : ""}${selected[1] === c.hash ? " compare" : ""}`}
        style={style}
        onMouseDown={(e) => {
          if (e.button === 0) actions.select(c.hash, e.metaKey || e.ctrlKey);
        }}
        onContextMenu={(e) => {
          if (!selected.includes(c.hash)) actions.select(c.hash);
          showContextMenu(e, menuFor(c));
        }}
        title={c.subject}
      >
        {graph && (
          <div className="cell graph-cell" style={{ width: gWidth }}>
            <GraphCell row={graph[i - pseudo.length]} commit={c} width={gWidth} isHead={isHead} />
          </div>
        )}
        <div className="cell msg">
          <RefLabels refs={c.refs} headName={headName} />
          <span className="subject">{c.subject}</span>
        </div>
        <div className="cell author">{c.author}</div>
        <div className="cell date">{formatDate(c.time)}</div>
        <div className="cell hash mono">{c.short}</div>
      </div>,
    );
  }

  return (
    <div className="grid-wrap">
      <div className="grid-header">
        {graph && <div className="cell graph-cell" style={{ width: gWidth }} />}
        <div className="cell msg">Message</div>
        <div className="cell author">Author</div>
        <div className="cell date">Date</div>
        <div className="cell hash">Commit ID</div>
      </div>
      <div
        ref={boxRef}
        className="grid"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
      >
        <div style={{ height: rowCount * ROW_H, position: "relative" }}>{rows}</div>
        {search && <div className="quick-search">🔍 {search}</div>}
        {!commits.length && <div className="empty">{q ? "No commits match the filter" : "No commits yet"}</div>}
      </div>
    </div>
  );
}
