import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  CloudDownload,
  GitBranch,
  Home,
  RefreshCw,
  Search,
  TerminalSquare,
} from "lucide-react";
import { api, Commit, isConflict, ops } from "./api";
import { basename, errorText } from "./lib/format";
import { Actions, INDEX, RepoContext, RepoData, stripRemote, WORKTREE } from "./repo";
import { BottomPanel } from "./components/BottomPanel";
import { CommitDialog } from "./components/CommitDialog";
import { Dashboard, loadRecent, touchRecent } from "./components/Dashboard";
import { FileHistory } from "./components/FileHistory";
import { RevisionGrid } from "./components/RevisionGrid";
import { Sidebar } from "./components/Sidebar";
import { ContextMenuHost, MenuItem, sep, showMenuAt } from "./components/ui/ContextMenu";
import { ask, confirm, DialogHost, info } from "./components/ui/Dialogs";
import { MenuBar, TopMenu } from "./components/ui/MenuBar";
import { Splitter, useSplit } from "./components/ui/Splitter";
import "./App.css";

const isMac = navigator.platform.toLowerCase().includes("mac");
const MOD = isMac ? "⌘" : "Ctrl+";

function pref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem("gitbench." + key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function setPref(key: string, v: string) {
  try {
    localStorage.setItem("gitbench." + key, v);
  } catch {
    /* ignore */
  }
}

async function pickFolder(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false });
  return typeof dir === "string" ? dir : null;
}

export default function App() {
  const [data, setData] = useState<RepoData | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [dashError, setDashError] = useState("");
  const [filter, setFilter] = useState("");
  const [showCommit, setShowCommit] = useState(false);
  const [historyPath, setHistoryPath] = useState<string | null>(null);
  const [allBranches, setAllBranches] = useState(() => pref("allBranches", "1") === "1");
  const [showLeft, setShowLeft] = useState(() => pref("showLeft", "1") === "1");
  const [showBottom, setShowBottom] = useState(() => pref("showBottom", "1") === "1");
  const [leftW, onSplitLeft] = useSplit("left", 240, "x", 140);
  const [bottomH, onSplitBottom] = useSplit("bottom", 300, "y", 120, true);
  const filterRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<string | null>(null);

  // --------------------------------------------------------------- loading

  const load = useCallback(
    async (root: string, keepSelection = true) => {
      const [info, commits, branches, tags, remotes, stashes, submodules, st] = await Promise.all([
        api.openRepo(root),
        api.log(root, { limit: 3000, all: allBranches }),
        api.branches(root),
        api.tags(root),
        api.remotes(root),
        api.stashes(root),
        api.submodules(root),
        api.status(root),
      ]);
      rootRef.current = info.root;
      setData({ info, commits, branches, tags, remotes, stashes, submodules, status: st });
      setSelected((cur) => {
        if (keepSelection && cur.length && cur.every((h) => h === WORKTREE || h === INDEX || commits.some((c) => c.hash === h)))
          return cur;
        return [st.length ? WORKTREE : info.head_hash || WORKTREE];
      });
    },
    [allBranches],
  );

  const refresh = useCallback(async () => {
    if (!rootRef.current) return;
    try {
      await load(rootRef.current);
    } catch (e) {
      setStatus(errorText(e));
    }
  }, [load]);

  useEffect(() => {
    refresh();
  }, [allBranches]); // eslint-disable-line

  // Refresh when the window regains focus (files may have changed outside).
  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      if (Date.now() - last < 1500 || busy) return;
      last = Date.now();
      refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, busy]);

  const openRepo = useCallback(
    async (path: string) => {
      try {
        setDashError("");
        const info = await api.openRepo(path);
        touchRecent(info.root);
        setFilter("");
        setSelected([]);
        await load(info.root, false);
        setStatus(`Opened ${info.root}`);
      } catch (e) {
        setDashError(errorText(e));
        setStatus(errorText(e));
      }
    },
    [load],
  );

  const browse = async () => {
    const dir = await pickFolder();
    if (dir) openRepo(dir);
  };

  const clone = async () => {
    const v = await ask({
      title: "Clone repository",
      fields: [
        { name: "url", label: "Repository to clone (URL or path)", type: "text", required: true, mono: true, placeholder: "https://github.com/user/repo.git" },
        { name: "parent", label: "Destination folder", type: "folder", required: true },
        { name: "name", label: "Subdirectory to create", type: "text", placeholder: "derived from URL" },
      ],
      ok: "Clone",
    });
    if (!v) return;
    const url = String(v.url).trim();
    const name = String(v.name).trim() || basename(url.replace(/\.git$/, "").replace(/[:/]+$/, "")).replace(/.*:/, "");
    const dest = `${String(v.parent).replace(/[\\/]+$/, "")}/${name}`;
    setBusy(true);
    setStatus(`Cloning ${url}…`);
    try {
      await api.cloneRepo(url, dest);
      await openRepo(dest);
    } catch (e) {
      setDashError(errorText(e));
      await info("Clone failed", <pre className="output">{errorText(e)}</pre>);
    } finally {
      setBusy(false);
    }
  };

  const init = async () => {
    const v = await ask({
      title: "Create new repository",
      fields: [
        { name: "path", label: "Directory", type: "folder", required: true },
        { name: "bare", label: "Bare repository (for sharing, no working directory)", type: "checkbox" },
      ],
      ok: "Create",
    });
    if (!v) return;
    try {
      await api.initRepo(String(v.path), !!v.bare);
      if (!v.bare) await openRepo(String(v.path));
      else setStatus(`Created bare repository ${v.path}`);
    } catch (e) {
      setDashError(errorText(e));
    }
  };

  // --------------------------------------------------------------- actions

  const actions: Actions | null = useMemo(() => {
    if (!data) return null;
    const root = data.info.root;
    const head = data.info.head;
    const localBranches = data.branches.filter((b) => !b.remote);
    const commitOf = (hash: string): Commit | undefined => data.commits.find((c) => c.hash === hash);
    const shortRef = (rev: string) => (/^[0-9a-f]{40,64}$/.test(rev) ? rev.slice(0, 8) : rev);

    const run: Actions["run"] = async (label, fn, opts = {}) => {
      setBusy(true);
      setStatus(`${label}…`);
      try {
        const out = await fn();
        const lastLine = typeof out === "string" ? out.trim().split("\n").filter(Boolean).pop() : "";
        setStatus(`${label}: done${lastLine ? " — " + lastLine : ""}`);
        return true;
      } catch (e) {
        setStatus(`${label}: failed`);
        if (!opts.quiet) await info(`${label} failed`, <pre className="output">{errorText(e)}</pre>);
        return false;
      } finally {
        setBusy(false);
        if (!opts.noRefresh) await refresh();
      }
    };

    const a: Actions = {
      refresh,
      run,
      select: (hash, add) =>
        setSelected((cur) => {
          if (!add) return [hash];
          if (cur.includes(hash)) return cur.filter((h) => h !== hash);
          return [cur[0] ?? hash, hash].filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 2);
        }),
      openCommitDialog: () => setShowCommit(true),
      openFileHistory: (p) => setHistoryPath(p),

      checkoutBranch: (name) => run(`Checkout ${name}`, () => ops.checkout(root, name)),
      checkoutRemoteBranch: async (name) => {
        const local = stripRemote(name, data.remotes);
        const existing = localBranches.find((b) => b.name === local);
        if (existing) {
          const v = await ask({
            title: "Checkout remote branch",
            message: (
              <>
                A local branch <b>{local}</b> already exists.
              </>
            ),
            fields: [
              {
                name: "how",
                label: "What to do",
                type: "radio",
                options: [
                  { value: "switch", label: `Checkout existing ${local}`, hint: "keep its commits" },
                  { value: "reset", label: `Reset ${local} to ${name}`, hint: "local-only commits are lost" },
                  { value: "new", label: "Create a branch with another name" },
                ],
              },
              { name: "other", label: "New branch name", type: "text", value: `${local}-2` },
            ],
          });
          if (!v) return;
          if (v.how === "switch") return void run(`Checkout ${local}`, () => ops.checkout(root, local));
          if (v.how === "reset") return void run(`Checkout ${local}`, () => api.git(root, ["switch", "-C", local, "--track", name]));
          return void run(`Checkout ${v.other}`, () => ops.checkoutRemote(root, name, String(v.other)));
        }
        run(`Checkout ${local}`, () => ops.checkoutRemote(root, name, local));
      },
      checkoutRevision: async (rev) => {
        if (await confirm("Checkout revision", <>Checkout <b>{shortRef(rev)}</b> in detached HEAD state? Commits made here will not belong to any branch.</>, "Checkout"))
          run(`Checkout ${shortRef(rev)}`, () => ops.checkoutDetached(root, rev));
      },
      createBranch: async (at) => {
        const c = commitOf(at);
        const v = await ask({
          title: "Create branch",
          message: (
            <>
              Create from <b>{c ? `${c.short} ${c.subject}` : shortRef(at)}</b>
            </>
          ),
          fields: [
            { name: "name", label: "Branch name", type: "text", required: true, mono: true },
            { name: "checkout", label: "Checkout after create", type: "checkbox", value: true },
            { name: "orphan", label: "Create orphan branch (no history, empty index)", type: "checkbox" },
          ],
          validate: (v) => (/\s|\.\.|[~^:?*[\\]/.test(String(v.name)) ? "Invalid branch name" : null),
          ok: "Create branch",
        });
        if (v) run(`Create branch ${v.name}`, () => ops.createBranch(root, String(v.name).trim(), at, !!v.checkout, !!v.orphan));
      },
      renameBranch: async (name) => {
        const v = await ask({
          title: "Rename branch",
          fields: [{ name: "to", label: `New name for ${name}`, type: "text", value: name, required: true, mono: true }],
          ok: "Rename",
        });
        if (v && v.to !== name) run(`Rename ${name}`, () => ops.renameBranch(root, name, String(v.to).trim()));
      },
      deleteBranch: async (name) => {
        const v = await ask({
          title: "Delete branch",
          message: (
            <>
              Delete local branch <b>{name}</b>?
            </>
          ),
          fields: [{ name: "force", label: "Force delete even if not merged (commits may be lost)", type: "checkbox" }],
          ok: "Delete",
          danger: true,
        });
        if (v) run(`Delete ${name}`, () => ops.deleteBranch(root, name, !!v.force));
      },
      deleteRemoteBranch: async (name) => {
        const remote = data.remotes.find((r) => name.startsWith(r.name + "/"))?.name ?? name.split("/")[0];
        const branch = stripRemote(name, data.remotes);
        if (await confirm("Delete remote branch", <>Delete <b>{branch}</b> on remote <b>{remote}</b>? This affects everyone using the remote.</>, "Delete", true))
          run(`Delete ${name}`, () => ops.deleteRemoteBranch(root, remote, branch));
      },
      setUpstream: async (branch) => {
        const remotes = data.branches.filter((b) => b.remote);
        if (!remotes.length) return void info("Set upstream", "There are no remote branches. Push the branch first.");
        const cur = data.branches.find((b) => b.name === branch)?.upstream;
        const v = await ask({
          title: `Set upstream of ${branch}`,
          fields: [{ name: "up", label: "Upstream branch", type: "select", value: cur || remotes[0].name, options: remotes.map((b) => ({ value: b.name, label: b.name })) }],
        });
        if (v) run("Set upstream", () => ops.setUpstream(root, branch, String(v.up)));
      },
      merge: async (rev) => {
        const v = await ask({
          title: "Merge branches",
          message: (
            <>
              Merge <b>{shortRef(rev)}</b> into current branch <b>{head}</b>
            </>
          ),
          fields: [
            {
              name: "mode",
              label: "Merge options",
              type: "radio",
              options: [
                { value: "ff", label: "Fast-forward if possible", hint: "default git behaviour" },
                { value: "noff", label: "Always create a merge commit", hint: "--no-ff" },
                { value: "squash", label: "Squash commits", hint: "--squash, commit yourself afterwards" },
              ],
            },
            { name: "noCommit", label: "Do not commit (inspect the result first)", type: "checkbox" },
          ],
          ok: "Merge",
        });
        if (!v) return;
        await run(`Merge ${shortRef(rev)}`, () =>
          ops.merge(root, rev, { noFf: v.mode === "noff", squash: v.mode === "squash", noCommit: !!v.noCommit }),
        );
      },
      rebase: async (rev) => {
        if (await confirm("Rebase", <>Rebase current branch <b>{head}</b> on <b>{shortRef(rev)}</b>? This rewrites the branch's commits.</>, "Rebase"))
          run(`Rebase on ${shortRef(rev)}`, () => ops.rebase(root, rev));
      },
      cherryPick: async (c) => {
        const v = await ask({
          title: "Cherry pick commit",
          message: (
            <>
              Apply <b>{c.short}</b> {c.subject} onto <b>{head}</b>
            </>
          ),
          fields: [{ name: "noCommit", label: "Do not commit (only change the working directory)", type: "checkbox" }],
          ok: "Cherry pick",
        });
        if (v) run(`Cherry pick ${c.short}`, () => ops.cherryPick(root, c.hash, !!v.noCommit));
      },
      revert: async (c) => {
        if (await confirm("Revert commit", <>Create a new commit that undoes <b>{c.short}</b> {c.subject}?{c.parents.length > 1 && <p>This is a merge commit; it is reverted relative to its first parent.</p>}</>, "Revert"))
          run(`Revert ${c.short}`, () => ops.revert(root, c.hash, c.parents.length > 1));
      },
      reset: async (hash) => {
        const c = commitOf(hash);
        const v = await ask({
          title: "Reset current branch",
          message: (
            <>
              Reset <b>{head}</b> to <b>{c ? `${c.short} ${c.subject}` : shortRef(hash)}</b>
            </>
          ),
          fields: [
            {
              name: "mode",
              label: "Reset type",
              type: "radio",
              value: "mixed",
              options: [
                { value: "soft", label: "Soft", hint: "keep working directory and index" },
                { value: "mixed", label: "Mixed", hint: "keep working directory, reset index" },
                { value: "hard", label: "Hard", hint: "discard all working directory changes!" },
              ],
            },
          ],
          ok: "Reset",
          danger: true,
        });
        if (!v) return;
        if (v.mode === "hard" && !(await confirm("Hard reset", "All uncommitted changes will be lost. Are you sure?", "Hard reset", true))) return;
        run(`Reset ${v.mode}`, () => ops.reset(root, v.mode as "soft" | "mixed" | "hard", hash));
      },
      createTag: async (hash) => {
        const c = commitOf(hash);
        const v = await ask({
          title: "Create tag",
          message: <>Tag commit <b>{c ? `${c.short} ${c.subject}` : shortRef(hash)}</b></>,
          fields: [
            { name: "name", label: "Tag name", type: "text", required: true, mono: true },
            { name: "message", label: "Message (creates an annotated tag; leave empty for lightweight)", type: "textarea" },
            { name: "push", label: "Push tag to remote", type: "checkbox" },
          ],
          ok: "Create tag",
        });
        if (!v) return;
        const name = String(v.name).trim();
        const ok = await run(`Create tag ${name}`, () => ops.createTag(root, name, hash, String(v.message).trim() || undefined));
        if (ok && v.push && data.remotes[0]) run(`Push tag ${name}`, () => ops.pushTag(root, data.remotes[0].name, name));
      },
      deleteTag: async (name) => {
        const v = await ask({
          title: "Delete tag",
          message: <>Delete tag <b>{name}</b>?</>,
          fields: data.remotes.length ? [{ name: "remote", label: `Also delete on remote ${data.remotes[0].name}`, type: "checkbox" }] : [],
          ok: "Delete",
          danger: true,
        });
        if (!v) return;
        run(`Delete tag ${name}`, async () => {
          await ops.deleteTag(root, name);
          if (v.remote) await api.git(root, ["push", data.remotes[0].name, "--delete", `refs/tags/${name}`]);
        });
      },
      pushTag: async (name) => {
        const remote = data.remotes[0]?.name;
        if (remote) run(`Push tag ${name}`, () => ops.pushTag(root, remote, name));
      },

      stash: async () => {
        if (!data.status.length) return void info("Stash", "There are no local changes to stash.");
        const v = await ask({
          title: "Stash changes",
          fields: [
            { name: "message", label: "Message (optional)", type: "text" },
            { name: "untracked", label: "Include untracked files", type: "checkbox", value: true },
            { name: "keepIndex", label: "Keep staged changes in the index", type: "checkbox" },
          ],
          ok: "Stash",
        });
        if (v) run("Stash", () => ops.stashPush(root, String(v.message), !!v.untracked, !!v.keepIndex));
      },
      stashPop: (name) => run("Stash pop", () => ops.stashPop(root, name)),
      stashApply: (name) => run(`Apply ${name}`, () => ops.stashApply(root, name)),
      stashDrop: async (name) => {
        if (await confirm("Drop stash", <>Permanently delete <b>{name}</b>?</>, "Drop", true)) run(`Drop ${name}`, () => ops.stashDrop(root, name));
      },

      fetch: (remote) => run(remote ? `Fetch ${remote}` : "Fetch all", () => ops.fetch(root, remote)),
      pull: (mode) => {
        const m = mode ?? pref<"merge" | "rebase" | "ff-only">("pullMode", "merge");
        run(`Pull (${m})`, () => ops.pull(root, m));
      },
      push: async (dialog) => {
        if (!data.remotes.length) return void info("Push", "This repository has no remotes. Add one under Repository → Remotes.");
        const current = data.branches.find((b) => b.current && !b.remote);
        if (!current) return void info("Push", "HEAD is detached. Checkout a branch to push.");
        const needsUpstream = !current.upstream;
        if (!dialog && !needsUpstream) return void run(`Push ${head}`, () => ops.push(root));
        const v = await ask({
          title: `Push ${head}`,
          message: needsUpstream ? <>Branch <b>{head}</b> has no upstream yet. It will be created on the remote.</> : undefined,
          fields: [
            { name: "remote", label: "Remote", type: "select", options: data.remotes.map((r) => ({ value: r.name, label: `${r.name}  ${r.push_url || r.fetch_url}` })) },
            { name: "force", label: "Force with lease (overwrite remote if unchanged since last fetch)", type: "checkbox" },
            { name: "tags", label: "Push annotated tags too", type: "checkbox" },
          ],
          ok: "Push",
        });
        if (!v) return;
        run(`Push ${head}`, () =>
          ops.push(root, {
            force: !!v.force,
            tags: !!v.tags,
            setUpstream: needsUpstream || v.remote !== current.upstream.split("/")[0] ? String(v.remote) : undefined,
          }),
        );
      },

      addRemote: async () => {
        const v = await ask({
          title: "Add remote",
          fields: [
            { name: "name", label: "Name", type: "text", value: data.remotes.length ? "upstream" : "origin", required: true },
            { name: "url", label: "URL", type: "text", required: true, mono: true },
            { name: "fetch", label: "Fetch after adding", type: "checkbox", value: true },
          ],
          ok: "Add",
        });
        if (!v) return;
        const ok = await run(`Add remote ${v.name}`, () => ops.addRemote(root, String(v.name).trim(), String(v.url).trim()));
        if (ok && v.fetch) run(`Fetch ${v.name}`, () => ops.fetch(root, String(v.name).trim()));
      },
      editRemote: async (name) => {
        const r = data.remotes.find((x) => x.name === name);
        if (!r) return;
        const v = await ask({
          title: `Edit remote ${name}`,
          fields: [
            { name: "name", label: "Name", type: "text", value: name, required: true },
            { name: "url", label: "URL", type: "text", value: r.fetch_url, required: true, mono: true },
          ],
          ok: "Save",
        });
        if (!v) return;
        run(`Edit remote ${name}`, async () => {
          if (v.url !== r.fetch_url) await ops.setRemoteUrl(root, name, String(v.url).trim());
          if (v.name !== name) await ops.renameRemote(root, name, String(v.name).trim());
        });
      },
      removeRemote: async (name) => {
        if (await confirm("Remove remote", <>Remove remote <b>{name}</b> and its remote-tracking branches?</>, "Remove", true))
          run(`Remove remote ${name}`, () => ops.removeRemote(root, name));
      },
      submoduleUpdate: (path) => run("Update submodules", () => ops.submoduleUpdate(root, path)),
      openSubmodule: (path) => openRepo(`${root}/${path}`),

      sequencer: async (action) => {
        if (action === "abort" && !(await confirm(`Abort ${data.info.state}`, "Abort and return to the state before the operation started?", "Abort", true))) return;
        run(`${action} ${data.info.state}`, () => ops.sequencer(root, data.info.state, action));
      },
      gotoCommit: async () => {
        const v = await ask({
          title: "Go to commit",
          fields: [{ name: "rev", label: "Commit hash, branch, tag or any revision expression", type: "text", required: true, mono: true }],
          ok: "Go",
        });
        if (!v) return;
        try {
          const hash = await ops.resolveRev(root, String(v.rev).trim());
          setSelected([hash]);
          if (!data.commits.some((c) => c.hash === hash)) setStatus(`${shortRef(hash)} is not in the loaded history; details shown below`);
        } catch {
          info("Go to commit", `Revision "${v.rev}" not found.`);
        }
      },
    };
    return a;
  }, [data, refresh, openRepo]);

  // --------------------------------------------------------------- keyboard

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!data || !actions || document.querySelector(".modal-backdrop")) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (e.key === "F5" || (mod && k === "r")) {
        e.preventDefault();
        refresh();
      } else if ((e.ctrlKey && e.key === " ") || (mod && k === "k")) {
        e.preventDefault();
        setShowCommit(true);
      } else if (mod && e.shiftKey && k === "g") {
        e.preventDefault();
        actions.gotoCommit();
      } else if (mod && k === "f") {
        e.preventDefault();
        filterRef.current?.focus();
      } else if (mod && k === "b" && selected[0] && selected[0] !== WORKTREE && selected[0] !== INDEX) {
        e.preventDefault();
        actions.createBranch(selected[0]);
      } else if (mod && k === "o") {
        e.preventDefault();
        browse();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }); // re-bind each render to see fresh state

  // --------------------------------------------------------------- menus

  const recentMenu: MenuItem[] = loadRecent()
    .slice(0, 15)
    .map((r) => ({ label: r.path, onClick: () => openRepo(r.path) }));

  const sel = selected[0];
  const selCommit = data?.commits.find((c) => c.hash === sel);
  const state = data?.info.state ?? "";

  const menus: TopMenu[] = !data || !actions
    ? []
    : [
        {
          label: "Start",
          items: [
            { label: "Open repository…", shortcut: `${MOD}O`, onClick: browse },
            { label: "Clone repository…", onClick: clone },
            { label: "Create new repository…", onClick: init },
            { label: "Recent repositories", disabled: !recentMenu.length, submenu: recentMenu },
            sep,
            { label: "Close (go to dashboard)", onClick: () => (setData(null), (rootRef.current = null)) },
          ],
        },
        {
          label: "Repository",
          items: [
            { label: "Refresh", shortcut: "F5", onClick: refresh },
            { label: "Show in file manager", onClick: () => revealItemInDir(data.info.root) },
            sep,
            { label: "Add remote…", onClick: actions.addRemote },
            {
              label: "Edit remote",
              disabled: !data.remotes.length,
              submenu: data.remotes.map((r) => ({ label: r.name, onClick: () => actions.editRemote(r.name) })),
            },
            { label: "Update all submodules", disabled: !data.submodules.length, onClick: () => actions.submoduleUpdate() },
            sep,
            {
              label: "User name and email…",
              onClick: async () => {
                const [n, e] = await Promise.all([ops.getConfig(data.info.root, "user.name"), ops.getConfig(data.info.root, "user.email")]);
                const v = await ask({
                  title: "Git user",
                  fields: [
                    { name: "name", label: "user.name", type: "text", value: n, required: true },
                    { name: "email", label: "user.email", type: "text", value: e, required: true },
                    { name: "global", label: "Save globally (all repositories)", type: "checkbox", value: true },
                  ],
                  ok: "Save",
                });
                if (v)
                  actions.run("Save user", async () => {
                    await ops.setConfig(data.info.root, "user.name", String(v.name), !!v.global);
                    await ops.setConfig(data.info.root, "user.email", String(v.email), !!v.global);
                  });
              },
            },
            {
              label: "Maintenance",
              submenu: [
                { label: "Compress git database (gc)", onClick: () => actions.run("Compress database", () => ops.gc(data.info.root)) },
                { label: "Verify database (fsck)", onClick: () => actions.run("Verify database", () => api.git(data.info.root, ["fsck"])) },
                { label: "Prune remote-tracking branches", onClick: () => actions.run("Prune", () => api.git(data.info.root, ["remote", "prune", ...data.remotes.map((r) => r.name)])) },
              ],
            },
          ],
        },
        {
          label: "Navigate",
          items: [
            { label: "Go to commit…", shortcut: `${MOD}⇧G`, onClick: actions.gotoCommit },
            { label: "Go to HEAD", disabled: !data.info.head_hash, onClick: () => setSelected([data.info.head_hash]) },
            { label: "Go to working directory", onClick: () => setSelected([WORKTREE]) },
            { label: "Go to parent commit", disabled: !selCommit?.parents.length, onClick: () => selCommit && setSelected([selCommit.parents[0]]) },
            sep,
            { label: "Find in history (filter)", shortcut: `${MOD}F`, onClick: () => filterRef.current?.focus() },
          ],
        },
        {
          label: "View",
          items: [
            { label: "Show all branches", checked: allBranches, onClick: () => (setPref("allBranches", allBranches ? "0" : "1"), setAllBranches(!allBranches)) },
            { label: "Show current branch only", checked: !allBranches, onClick: () => (setPref("allBranches", "0"), setAllBranches(false)) },
            sep,
            { label: "Left panel", checked: showLeft, onClick: () => (setPref("showLeft", showLeft ? "0" : "1"), setShowLeft(!showLeft)) },
            { label: "Bottom panel", checked: showBottom, onClick: () => (setPref("showBottom", showBottom ? "0" : "1"), setShowBottom(!showBottom)) },
          ],
        },
        {
          label: "Commands",
          items: [
            { label: "Commit…", shortcut: isMac ? "⌘K" : "Ctrl+Space", onClick: () => setShowCommit(true) },
            {
              label: "Pull",
              submenu: [
                { label: "Pull — merge", onClick: () => actions.pull("merge") },
                { label: "Pull — rebase", onClick: () => actions.pull("rebase") },
                { label: "Pull — fast-forward only", onClick: () => actions.pull("ff-only") },
              ],
            },
            { label: "Fetch all", onClick: () => actions.fetch() },
            { label: "Push…", onClick: () => actions.push(true) },
            sep,
            { label: "Stash changes…", onClick: actions.stash },
            { label: "Stash pop", disabled: !data.stashes.length, onClick: () => actions.stashPop() },
            sep,
            { label: "Create branch…", shortcut: `${MOD}B`, onClick: () => actions.createBranch(sel && sel !== WORKTREE && sel !== INDEX ? sel : data.info.head_hash || "HEAD") },
            {
              label: "Checkout branch",
              submenu: data.branches.filter((b) => !b.remote).map((b) => ({ label: b.name, checked: b.current, disabled: b.current, onClick: () => actions.checkoutBranch(b.name) })),
            },
            {
              label: "Merge branch into current",
              submenu: data.branches.filter((b) => !b.current).map((b) => ({ label: b.name, onClick: () => actions.merge(b.name) })),
            },
            {
              label: "Rebase current branch on",
              submenu: data.branches.filter((b) => !b.current).map((b) => ({ label: b.name, onClick: () => actions.rebase(b.name) })),
            },
            { label: "Create tag…", disabled: !selCommit, onClick: () => selCommit && actions.createTag(selCommit.hash) },
            sep,
            { label: "Cherry pick selected commit…", disabled: !selCommit, onClick: () => selCommit && actions.cherryPick(selCommit) },
            { label: "Revert selected commit…", disabled: !selCommit, onClick: () => selCommit && actions.revert(selCommit) },
            { label: "Reset current branch to selected…", disabled: !selCommit, onClick: () => selCommit && actions.reset(selCommit.hash) },
            sep,
            {
              label: "Format patch from selected commit…",
              disabled: !selCommit,
              onClick: async () => {
                const dir = await pickFolder();
                if (dir && selCommit) actions.run("Format patch", () => ops.formatPatch(data.info.root, selCommit.hash, dir));
              },
            },
            {
              label: "Apply patch (mailbox)…",
              onClick: async () => {
                const f = await open({ multiple: false, filters: [{ name: "Patch", extensions: ["patch", "diff", "eml", "mbox"] }] });
                if (typeof f === "string") actions.run("Apply patch", () => ops.applyMailbox(data.info.root, f));
              },
            },
            sep,
            { label: `Continue ${state}`, disabled: !state, onClick: () => actions.sequencer("continue") },
            { label: `Skip commit (${state || "rebase"})`, disabled: state !== "rebasing" && state !== "cherry-picking", onClick: () => actions.sequencer("skip") },
            { label: `Abort ${state}`, disabled: !state, danger: true, onClick: () => actions.sequencer("abort") },
          ],
        },
        {
          label: "Help",
          items: [
            {
              label: "Keyboard shortcuts",
              onClick: () =>
                info(
                  "Keyboard shortcuts",
                  <table className="kv">
                    <tbody>
                      {[
                        ["Commit dialog", isMac ? "⌘K or Ctrl+Space" : "Ctrl+Space or Ctrl+K"],
                        ["Refresh", `F5 / ${MOD}R`],
                        ["Go to commit", `${MOD}⇧G`],
                        ["Filter history", `${MOD}F`],
                        ["Create branch at selected", `${MOD}B`],
                        ["Open repository", `${MOD}O`],
                        ["Compare two commits", `${MOD}click second commit`],
                        ["Quick search", "type in the revision list"],
                        ["Stage / Unstage / Reset (commit dialog)", "S / U / R"],
                        ["Commit (commit dialog)", `${MOD}Enter`],
                      ].map(([a, b]) => (
                        <tr key={a}>
                          <th>{a}</th>
                          <td>{b}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>,
                ),
            },
            { label: "Git documentation", onClick: () => openUrl("https://git-scm.com/docs") },
            {
              label: "About gitbench",
              onClick: () => info("About gitbench", <p>gitbench 0.2 — a cross-platform Git GUI. Workflow inspired by Git Extensions.</p>),
            },
          ],
        },
      ];

  // --------------------------------------------------------------- render

  const host = (
    <>
      <ContextMenuHost />
      <DialogHost pickFolder={pickFolder} />
    </>
  );

  if (!data || !actions) {
    return (
      <>
        <Dashboard onOpen={openRepo} onBrowse={browse} onClone={clone} onInit={init} error={dashError} />
        {busy && <div className="busy-overlay">{status}</div>}
        {host}
      </>
    );
  }

  const changes = data.status.length;
  const conflicts = data.status.filter(isConflict).length;
  const current = data.branches.find((b) => b.current && !b.remote);
  const pullMode = pref("pullMode", "merge");

  return (
    <RepoContext.Provider value={{ data, actions, selected }}>
      <div className="app">
        <MenuBar menus={menus} />
        <div className="toolbar">
          <button className="tb" title="Dashboard" onClick={() => (setData(null), (rootRef.current = null))}>
            <Home size={16} />
          </button>
          <button
            className="tb tb-drop repo-btn"
            title={data.info.root}
            onClick={(e) =>
              showMenuAt(e.currentTarget, [
                ...recentMenu,
                sep,
                { label: "Open repository…", onClick: browse },
                { label: "Clone repository…", onClick: clone },
              ])
            }
          >
            <b>{basename(data.info.root)}</b> <ChevronDown size={12} />
          </button>
          <button
            className="tb tb-drop"
            title="Checkout branch"
            onClick={(e) =>
              showMenuAt(e.currentTarget, [
                ...data.branches
                  .filter((b) => !b.remote)
                  .map((b) => ({ label: b.name, checked: b.current, disabled: b.current, onClick: () => actions.checkoutBranch(b.name) })),
                sep,
                { label: "Create branch…", onClick: () => actions.createBranch(data.info.head_hash || "HEAD") },
              ])
            }
          >
            <GitBranch size={15} /> {data.info.head} <ChevronDown size={12} />
          </button>
          <button className="tb" title="Refresh (F5)" onClick={refresh} disabled={busy}>
            <RefreshCw size={15} className={busy ? "spin" : ""} />
          </button>
          <span className="tb-sep" />
          <div className="tb-split">
            <button className="tb" title="Stash changes" onClick={actions.stash} disabled={busy}>
              <Archive size={15} /> Stash
            </button>
            <button
              className="tb tb-arrow"
              disabled={busy}
              onClick={(e) =>
                showMenuAt(e.currentTarget.parentElement!, [
                  { label: "Stash changes…", onClick: actions.stash },
                  { label: "Stash pop", disabled: !data.stashes.length, onClick: () => actions.stashPop() },
                  sep,
                  ...data.stashes.slice(0, 10).map((s) => ({
                    label: `${s.name}: ${s.message}`,
                    submenu: [
                      { label: "Apply", onClick: () => actions.stashApply(s.name) },
                      { label: "Pop", onClick: () => actions.stashPop(s.name) },
                      { label: "Show", onClick: () => setSelected([s.hash]) },
                      { label: "Drop…", danger: true, onClick: () => actions.stashDrop(s.name) },
                    ],
                  })),
                ])
              }
            >
              <ChevronDown size={12} />
            </button>
          </div>
          <button className={`tb commit-btn${changes ? " has-changes" : ""}`} title={`Commit (${isMac ? "⌘K" : "Ctrl+Space"})`} onClick={() => setShowCommit(true)} disabled={busy}>
            <Check size={15} /> Commit{changes ? ` (${changes})` : ""}
          </button>
          <span className="tb-sep" />
          <div className="tb-split">
            <button className="tb" title={`Pull (${pullMode})`} onClick={() => actions.pull()} disabled={busy || !data.remotes.length}>
              <ArrowDownToLine size={15} /> Pull
            </button>
            <button
              className="tb tb-arrow"
              disabled={busy || !data.remotes.length}
              onClick={(e) =>
                showMenuAt(e.currentTarget.parentElement!, [
                  ...(["merge", "rebase", "ff-only"] as const).map((m) => ({
                    label: `Pull — ${m === "ff-only" ? "fast-forward only" : m}`,
                    checked: pullMode === m,
                    onClick: () => {
                      setPref("pullMode", m);
                      actions.pull(m);
                    },
                  })),
                  sep,
                  { label: "Fetch all", onClick: () => actions.fetch() },
                  ...data.remotes.map((r) => ({ label: `Fetch ${r.name}`, onClick: () => actions.fetch(r.name) })),
                ])
              }
            >
              <ChevronDown size={12} />
            </button>
          </div>
          <button className="tb" title="Fetch all remotes" onClick={() => actions.fetch()} disabled={busy || !data.remotes.length}>
            <CloudDownload size={15} /> Fetch
          </button>
          <div className="tb-split">
            <button className="tb" title="Push current branch" onClick={() => actions.push(false)} disabled={busy}>
              <ArrowUpFromLine size={15} /> Push
            </button>
            <button
              className="tb tb-arrow"
              disabled={busy}
              onClick={(e) =>
                showMenuAt(e.currentTarget.parentElement!, [
                  { label: "Push…", onClick: () => actions.push(true) },
                  { label: "Push all tags", disabled: !data.remotes.length, onClick: () => actions.run("Push tags", () => api.git(data.info.root, ["push", data.remotes[0].name, "--tags"])) },
                ])
              }
            >
              <ChevronDown size={12} />
            </button>
          </div>
          <span className="tb-sep" />
          <button className="tb" title="Console tab" onClick={() => (setShowBottom(true), setTimeout(() => window.dispatchEvent(new Event("gitbench:console"))))}>
            <TerminalSquare size={15} />
          </button>
          <div className="tb-filter">
            <Search size={14} />
            <input
              ref={filterRef}
              placeholder="Filter: message, author, hash, branch"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setFilter("")}
            />
          </div>
        </div>

        {state && (
          <div className="banner warn">
            <b>{state[0].toUpperCase() + state.slice(1)} in progress.</b>
            {conflicts > 0 ? ` ${conflicts} conflicted file${conflicts > 1 ? "s" : ""} — resolve them in the commit dialog.` : " No conflicts left."}
            <button onClick={() => setShowCommit(true)}>Open commit dialog</button>
            <button disabled={conflicts > 0} onClick={() => actions.sequencer("continue")}>
              Continue
            </button>
            {(state === "rebasing" || state === "cherry-picking") && <button onClick={() => actions.sequencer("skip")}>Skip</button>}
            <button className="danger" onClick={() => actions.sequencer("abort")}>
              Abort
            </button>
          </div>
        )}

        <div className="main">
          {showLeft && (
            <>
              <div style={{ width: leftW, display: "flex" }}>
                <Sidebar />
              </div>
              <Splitter dir="x" onMouseDown={onSplitLeft} />
            </>
          )}
          <section className="content">
            <RevisionGrid filter={filter} onOpenCommit={() => setShowCommit(true)} />
            {showBottom && (
              <>
                <Splitter dir="y" onMouseDown={onSplitBottom} />
                <div style={{ height: bottomH, display: "flex" }}>
                  <BottomPanel />
                </div>
              </>
            )}
          </section>
        </div>

        <footer className="statusbar">
          <span className="status-msg">{status || data.info.root}</span>
          {current?.upstream && (
            <span title={`upstream ${current.upstream}`}>
              {current.upstream} {current.track}
            </span>
          )}
          <span>{data.commits.length >= 3000 ? "3000+ commits (limited)" : `${data.commits.length} commits`}</span>
        </footer>
      </div>
      {showCommit && (
        <CommitDialog
          onClose={(committed) => {
            setShowCommit(false);
            if (committed) setStatus(committed);
            refresh();
          }}
        />
      )}
      {historyPath && <FileHistory path={historyPath} onClose={() => setHistoryPath(null)} />}
      {busy && <div className="busy-bar" />}
      {host}
    </RepoContext.Provider>
  );
}
