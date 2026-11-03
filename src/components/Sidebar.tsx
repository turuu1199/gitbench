import { useMemo, useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Cloud,
  Folder,
  GitBranch,
  Package,
  Tag as TagIcon,
} from "lucide-react";
import type { Branch } from "../api";
import { copyText } from "../lib/format";
import { useRepo } from "../repo";
import { MenuItem, sep, showContextMenu } from "./ui/ContextMenu";

interface TreeNode {
  name: string;
  full: string;
  children: Map<string, TreeNode>;
  branch?: Branch;
}

/** Group branch names by "/" into folders (feature/x, feature/y -> feature/{x,y}). */
function buildTree(branches: Branch[], strip = ""): TreeNode {
  const root: TreeNode = { name: "", full: "", children: new Map() };
  for (const b of branches) {
    const rel = strip && b.name.startsWith(strip) ? b.name.slice(strip.length) : b.name;
    const parts = rel.split("/");
    let node = root;
    parts.forEach((p, i) => {
      const full = parts.slice(0, i + 1).join("/");
      if (!node.children.has(p)) node.children.set(p, { name: p, full, children: new Map() });
      node = node.children.get(p)!;
    });
    node.branch = b;
  }
  return root;
}

function useCollapsed() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(["tags", "stashes", "submodules"]));
  const toggle = (k: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return [collapsed, toggle] as const;
}

export function Sidebar() {
  const { data, actions, selected } = useRepo();
  const [collapsed, toggle] = useCollapsed();
  const [filter, setFilter] = useState("");
  const f = filter.toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);

  const local = useMemo(() => data.branches.filter((b) => !b.remote && match(b.name)), [data.branches, f]); // eslint-disable-line
  const localTree = useMemo(() => buildTree(local), [local]);
  const remoteTrees = useMemo(
    () =>
      data.remotes.map((r) => ({
        remote: r,
        tree: buildTree(
          data.branches.filter((b) => b.remote && b.name.startsWith(r.name + "/") && match(b.name)),
          r.name + "/",
        ),
      })),
    [data.branches, data.remotes, f], // eslint-disable-line
  );
  const tags = data.tags.filter((t) => match(t.name));
  const stashes = data.stashes.filter((s) => match(s.message));
  const subs = data.submodules.filter((s) => match(s.path));

  const branchMenu = (b: Branch): MenuItem[] =>
    b.remote
      ? [
          { label: "Checkout as new local branch", onClick: () => actions.checkoutRemoteBranch(b.name) },
          { label: "Create branch from here…", onClick: () => actions.createBranch(b.hash) },
          { label: `Merge into ${data.info.head}`, onClick: () => actions.merge(b.name) },
          { label: `Rebase ${data.info.head} on this`, onClick: () => actions.rebase(b.name) },
          sep,
          { label: "Fetch", onClick: () => actions.fetch(b.name.split("/")[0]) },
          { label: "Delete branch on remote…", danger: true, onClick: () => actions.deleteRemoteBranch(b.name) },
          sep,
          { label: "Copy name", onClick: () => copyText(b.name) },
        ]
      : [
          { label: "Checkout", disabled: b.current, onClick: () => actions.checkoutBranch(b.name) },
          { label: "Create branch from here…", onClick: () => actions.createBranch(b.hash) },
          { label: `Merge into ${data.info.head}`, disabled: b.current, onClick: () => actions.merge(b.name) },
          { label: `Rebase ${data.info.head} on this`, disabled: b.current, onClick: () => actions.rebase(b.name) },
          { label: "Reset current branch to here…", disabled: b.current, onClick: () => actions.reset(b.hash) },
          sep,
          { label: "Set upstream branch…", onClick: () => actions.setUpstream(b.name) },
          { label: "Rename…", onClick: () => actions.renameBranch(b.name) },
          { label: "Delete…", danger: true, disabled: b.current, onClick: () => actions.deleteBranch(b.name) },
          sep,
          { label: "Copy name", onClick: () => copyText(b.name) },
        ];

  const renderTree = (node: TreeNode, keyPrefix: string, depth: number): React.ReactNode[] =>
    [...node.children.values()]
      .sort((a, b) => Number(!!a.branch && !a.children.size) - Number(!!b.branch && !b.children.size) || a.name.localeCompare(b.name))
      .flatMap((n) => {
        const key = `${keyPrefix}/${n.full}`;
        const out: React.ReactNode[] = [];
        if (n.branch) {
          const b = n.branch;
          out.push(
            <div
              key={key}
              className={`node leaf${b.current ? " current" : ""}${selected[0] === b.hash ? " hl" : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => actions.select(b.hash)}
              onDoubleClick={() => (b.remote ? actions.checkoutRemoteBranch(b.name) : !b.current && actions.checkoutBranch(b.name))}
              onContextMenu={(e) => showContextMenu(e, branchMenu(b))}
              title={b.upstream ? `${b.name} → ${b.upstream} ${b.track}` : b.name}
            >
              <GitBranch size={13} className="icon" />
              <span className="label">{n.name}</span>
              {b.track && <span className="track">{b.track.replace(/[[\]]/g, "")}</span>}
            </div>,
          );
        }
        if (n.children.size) {
          const open = !collapsed.has(key);
          out.push(
            <div key={key + "#dir"} className="node" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(key)}>
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <Folder size={13} className="icon" />
              <span className="label">{n.name}</span>
            </div>,
          );
          if (open) out.push(...renderTree(n, keyPrefix, depth + 1));
        }
        return out;
      });

  const Section = ({
    id,
    title,
    icon,
    count,
    children,
    menu,
  }: {
    id: string;
    title: string;
    icon: React.ReactNode;
    count: number;
    children: React.ReactNode;
    menu?: MenuItem[];
  }) => (
    <div className="section">
      <div className="node section-title" onClick={() => toggle(id)} onContextMenu={(e) => menu && showContextMenu(e, menu)}>
        {collapsed.has(id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        {icon}
        <span className="label">{title}</span>
        <span className="count">{count}</span>
      </div>
      {!collapsed.has(id) && children}
    </div>
  );

  return (
    <aside className="sidebar">
      <input className="sidebar-filter" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="tree">
        <Section id="branches" title="Branches" icon={<GitBranch size={14} className="icon" />} count={local.length}>
          {renderTree(localTree, "b", 1)}
        </Section>
        <Section
          id="remotes"
          title="Remotes"
          icon={<Cloud size={14} className="icon" />}
          count={data.remotes.length}
          menu={[
            { label: "Fetch all", onClick: () => actions.fetch() },
            { label: "Add remote…", onClick: actions.addRemote },
          ]}
        >
          {remoteTrees.map(({ remote, tree }) => {
            const key = "r:" + remote.name;
            const open = !collapsed.has(key);
            return (
              <div key={key}>
                <div
                  className="node"
                  style={{ paddingLeft: 22 }}
                  onClick={() => toggle(key)}
                  title={remote.fetch_url}
                  onContextMenu={(e) =>
                    showContextMenu(e, [
                      { label: `Fetch ${remote.name}`, onClick: () => actions.fetch(remote.name) },
                      { label: "Edit remote…", onClick: () => actions.editRemote(remote.name) },
                      { label: "Copy URL", onClick: () => copyText(remote.fetch_url) },
                      sep,
                      { label: "Remove remote…", danger: true, onClick: () => actions.removeRemote(remote.name) },
                    ])
                  }
                >
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <Cloud size={13} className="icon" />
                  <span className="label">{remote.name}</span>
                </div>
                {open && renderTree(tree, key, 2)}
              </div>
            );
          })}
        </Section>
        <Section id="tags" title="Tags" icon={<TagIcon size={14} className="icon" />} count={tags.length}>
          {tags.map((t) => (
            <div
              key={t.name}
              className={`node leaf${selected[0] === t.hash ? " hl" : ""}`}
              style={{ paddingLeft: 22 }}
              onClick={() => actions.select(t.hash)}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: "Checkout this tag (detached)", onClick: () => actions.checkoutRevision(t.name) },
                  { label: "Create branch from here…", onClick: () => actions.createBranch(t.hash) },
                  { label: `Merge into ${data.info.head}`, onClick: () => actions.merge(t.name) },
                  sep,
                  { label: "Push tag to remote", disabled: !data.remotes.length, onClick: () => actions.pushTag(t.name) },
                  { label: "Delete tag…", danger: true, onClick: () => actions.deleteTag(t.name) },
                  sep,
                  { label: "Copy name", onClick: () => copyText(t.name) },
                ])
              }
            >
              <TagIcon size={13} className="icon" />
              <span className="label">{t.name}</span>
            </div>
          ))}
        </Section>
        <Section
          id="submodules"
          title="Submodules"
          icon={<Package size={14} className="icon" />}
          count={subs.length}
          menu={[{ label: "Update all submodules", onClick: () => actions.submoduleUpdate() }]}
        >
          {subs.map((s) => (
            <div
              key={s.path}
              className="node leaf"
              style={{ paddingLeft: 22 }}
              title={`${s.hash}${s.status === "+" ? " (modified)" : s.status === "-" ? " (not initialized)" : ""}`}
              onDoubleClick={() => actions.openSubmodule(s.path)}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: "Open submodule", onClick: () => actions.openSubmodule(s.path) },
                  { label: "Update (init, recursive)", onClick: () => actions.submoduleUpdate(s.path) },
                ])
              }
            >
              <Package size={13} className="icon" />
              <span className="label">{s.path}</span>
              {s.status !== " " && <span className="track">{s.status === "+" ? "modified" : s.status === "-" ? "uninit" : s.status}</span>}
            </div>
          ))}
        </Section>
        <Section
          id="stashes"
          title="Stashes"
          icon={<Archive size={14} className="icon" />}
          count={stashes.length}
          menu={[{ label: "Stash changes…", onClick: actions.stash }]}
        >
          {stashes.map((s) => (
            <div
              key={s.name}
              className={`node leaf${selected[0] === s.hash ? " hl" : ""}`}
              style={{ paddingLeft: 22 }}
              onClick={() => actions.select(s.hash)}
              title={s.name}
              onContextMenu={(e) =>
                showContextMenu(e, [
                  { label: "Apply", onClick: () => actions.stashApply(s.name) },
                  { label: "Pop", onClick: () => actions.stashPop(s.name) },
                  sep,
                  { label: "Drop…", danger: true, onClick: () => actions.stashDrop(s.name) },
                ])
              }
            >
              <Archive size={13} className="icon" />
              <span className="label">{s.message}</span>
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}
