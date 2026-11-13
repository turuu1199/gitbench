import { invoke } from "@tauri-apps/api/core";

export interface RepoInfo {
  root: string;
  head: string;
  head_hash: string;
  state: "" | "merging" | "rebasing" | "cherry-picking" | "reverting";
}

export interface Commit {
  hash: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  time: number;
  refs: string[];
  subject: string;
}

export interface CommitInfo {
  hash: string;
  parents: string[];
  author: string;
  author_email: string;
  author_time: number;
  committer: string;
  committer_email: string;
  commit_time: number;
  message: string;
  branches: string[];
  tags: string[];
}

export interface Branch {
  name: string;
  remote: boolean;
  current: boolean;
  hash: string;
  upstream: string;
  track: string;
}

export interface Tag {
  name: string;
  hash: string;
}

export interface Remote {
  name: string;
  fetch_url: string;
  push_url: string;
}

export interface Stash {
  name: string;
  hash: string;
  message: string;
}

export interface Submodule {
  path: string;
  hash: string;
  status: string;
}

export interface FileChange {
  path: string;
  orig_path: string | null;
  index: string;
  worktree: string;
}

export interface ChangedFile {
  path: string;
  orig_path: string | null;
  status: string;
}

export interface BlameLine {
  hash: string;
  author: string;
  time: number;
  summary: string;
  line: string;
}

/** Status letter of a conflicted (unmerged) entry. */
export const isConflict = (f: FileChange) =>
  f.index === "U" || f.worktree === "U" || (f.index === "A" && f.worktree === "A") || (f.index === "D" && f.worktree === "D");

export const api = {
  /** Run any git command. Returns stdout + stderr. */
  git: (repo: string, args: string[]) => invoke<string>("git", { repo, args }),
  gitStdin: (repo: string, args: string[], input: string) =>
    invoke<string>("git_stdin", { repo, args, input }),

  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  initRepo: (path: string, bare = false) => invoke<string>("init_repo", { path, bare }),
  cloneRepo: (url: string, dest: string) => invoke<string>("clone_repo", { url, dest }),

  log: (repo: string, opts: { limit?: number; all?: boolean; path?: string; rev?: string } = {}) =>
    invoke<Commit[]>("log", { repo, ...opts }),
  commitInfo: (repo: string, hash: string) => invoke<CommitInfo>("commit_info", { repo, hash }),
  branches: (repo: string) => invoke<Branch[]>("branches", { repo }),
  tags: (repo: string) => invoke<Tag[]>("tags", { repo }),
  remotes: (repo: string) => invoke<Remote[]>("remotes", { repo }),
  stashes: (repo: string) => invoke<Stash[]>("stashes", { repo }),
  submodules: (repo: string) => invoke<Submodule[]>("submodules", { repo }),
  status: (repo: string) => invoke<FileChange[]>("status", { repo }),

  commitFiles: (repo: string, hash: string, base?: string | null) =>
    invoke<ChangedFile[]>("commit_files", { repo, hash, base: base ?? null }),
  diffCommitFile: (repo: string, hash: string, base: string | null, path: string, origPath?: string | null) =>
    invoke<string>("diff_commit_file", { repo, hash, base, path, origPath: origPath ?? null }),
  diffFile: (repo: string, path: string, staged: boolean, untracked: boolean) =>
    invoke<string>("diff_file", { repo, path, staged, untracked }),
  showCommit: (repo: string, hash: string) => invoke<string>("show_commit", { repo, hash }),
  lsTree: (repo: string, hash: string) => invoke<string[]>("ls_tree", { repo, hash }),
  fileAt: (repo: string, hash: string, path: string) => invoke<string>("file_at", { repo, hash, path }),
  appendGitignore: (repo: string, pattern: string) => invoke<void>("append_gitignore", { repo, pattern }),
  readWorktreeFile: (repo: string, path: string) => invoke<string>("read_worktree_file", { repo, path }),
  writeWorktreeFile: (repo: string, path: string, content: string) =>
    invoke<void>("write_worktree_file", { repo, path, content }),
  blame: (repo: string, path: string, hash?: string | null) =>
    invoke<BlameLine[]>("blame", { repo, path, hash: hash ?? null }),
};

/** Git write operations, composed from `api.git`. */
export const ops = {
  stage: (r: string, paths: string[]) => api.git(r, ["add", "--", ...paths]),
  unstage: (r: string, paths: string[]) => api.git(r, ["reset", "-q", "HEAD", "--", ...paths]),
  /** Discard working-tree changes. Untracked files are deleted. */
  discard: async (r: string, tracked: string[], untracked: string[]) => {
    if (tracked.length) await api.git(r, ["checkout", "--", ...tracked]);
    if (untracked.length) await api.git(r, ["clean", "-f", "--", ...untracked]);
  },
  applyPatch: (r: string, patch: string, opts: { cached?: boolean; reverse?: boolean }) =>
    api.gitStdin(
      r,
      ["apply", "--recount", "--whitespace=nowarn", ...(opts.cached ? ["--cached"] : []), ...(opts.reverse ? ["--reverse"] : []), "-"],
      patch,
    ),
  commit: (r: string, message: string, opts: { amend?: boolean; resetAuthor?: boolean; noVerify?: boolean } = {}) =>
    api.git(r, [
      "commit",
      "-m",
      message,
      ...(opts.amend ? ["--amend"] : []),
      ...(opts.resetAuthor ? ["--reset-author"] : []),
      ...(opts.noVerify ? ["--no-verify"] : []),
    ]),
  lastMessage: (r: string) => api.git(r, ["log", "-1", "--format=%B"]),

  checkout: (r: string, branch: string) => api.git(r, ["switch", branch]),
  checkoutRemote: (r: string, remoteBranch: string, localName: string) =>
    api.git(r, ["switch", "-c", localName, "--track", remoteBranch]),
  checkoutDetached: (r: string, rev: string) => api.git(r, ["switch", "--detach", rev]),
  createBranch: (r: string, name: string, start: string, checkout: boolean, orphan = false) =>
    orphan
      ? api.git(r, ["switch", "--orphan", name])
      : checkout
        ? api.git(r, ["switch", "-c", name, start])
        : api.git(r, ["branch", name, start]),
  renameBranch: (r: string, from: string, to: string) => api.git(r, ["branch", "-m", from, to]),
  deleteBranch: (r: string, name: string, force: boolean) => api.git(r, ["branch", force ? "-D" : "-d", name]),
  deleteRemoteBranch: (r: string, remote: string, name: string) => api.git(r, ["push", remote, "--delete", name]),
  setUpstream: (r: string, branch: string, upstream: string) =>
    api.git(r, ["branch", `--set-upstream-to=${upstream}`, branch]),

  merge: (r: string, rev: string, opts: { noFf?: boolean; squash?: boolean; noCommit?: boolean } = {}) =>
    api.git(r, [
      "merge",
      ...(opts.noFf ? ["--no-ff"] : []),
      ...(opts.squash ? ["--squash"] : []),
      ...(opts.noCommit ? ["--no-commit"] : []),
      rev,
    ]),
  rebase: (r: string, onto: string) => api.git(r, ["rebase", onto]),
  /** Continue / abort / skip whatever is in progress. */
  sequencer: (r: string, state: string, action: "continue" | "abort" | "skip") => {
    const cmd = { merging: "merge", rebasing: "rebase", "cherry-picking": "cherry-pick", reverting: "revert" }[state];
    if (!cmd) return Promise.reject("nothing in progress");
    return api.git(r, [cmd, `--${action}`]);
  },
  cherryPick: (r: string, hash: string, noCommit = false) =>
    api.git(r, ["cherry-pick", ...(noCommit ? ["--no-commit"] : []), hash]),
  revert: (r: string, hash: string, isMerge = false) =>
    api.git(r, ["revert", "--no-edit", ...(isMerge ? ["-m", "1"] : []), hash]),
  reset: (r: string, mode: "soft" | "mixed" | "hard", rev: string) => api.git(r, ["reset", `--${mode}`, rev]),

  createTag: (r: string, name: string, rev: string, message?: string) =>
    message ? api.git(r, ["tag", "-a", name, "-m", message, rev]) : api.git(r, ["tag", name, rev]),
  deleteTag: (r: string, name: string) => api.git(r, ["tag", "-d", name]),
  pushTag: (r: string, remote: string, name: string) => api.git(r, ["push", remote, `refs/tags/${name}`]),

  stashPush: (r: string, message: string, untracked: boolean, keepIndex = false) =>
    api.git(r, [
      "stash",
      "push",
      ...(untracked ? ["--include-untracked"] : []),
      ...(keepIndex ? ["--keep-index"] : []),
      ...(message ? ["-m", message] : []),
    ]),
  stashPop: (r: string, name = "stash@{0}") => api.git(r, ["stash", "pop", name]),
  stashApply: (r: string, name: string) => api.git(r, ["stash", "apply", name]),
  stashDrop: (r: string, name: string) => api.git(r, ["stash", "drop", name]),

  fetch: (r: string, remote?: string) => api.git(r, ["fetch", "--prune", ...(remote ? [remote] : ["--all"])]),
  pull: (r: string, mode: "merge" | "rebase" | "ff-only") =>
    api.git(r, ["pull", mode === "merge" ? "--no-rebase" : mode === "rebase" ? "--rebase" : "--ff-only"]),
  push: (r: string, opts: { force?: boolean; setUpstream?: string; tags?: boolean } = {}) =>
    api.git(r, [
      "push",
      ...(opts.force ? ["--force-with-lease"] : []),
      ...(opts.tags ? ["--follow-tags"] : []),
      ...(opts.setUpstream ? ["-u", opts.setUpstream, "HEAD"] : []),
    ]),

  addRemote: (r: string, name: string, url: string) => api.git(r, ["remote", "add", name, url]),
  removeRemote: (r: string, name: string) => api.git(r, ["remote", "remove", name]),
  renameRemote: (r: string, from: string, to: string) => api.git(r, ["remote", "rename", from, to]),
  setRemoteUrl: (r: string, name: string, url: string) => api.git(r, ["remote", "set-url", name, url]),

  submoduleUpdate: (r: string, path?: string) =>
    api.git(r, ["submodule", "update", "--init", "--recursive", ...(path ? ["--", path] : [])]),

  getConfig: (r: string, key: string) => api.git(r, ["config", "--get", key]).then((s) => s.trim()).catch(() => ""),
  setConfig: (r: string, key: string, value: string, global: boolean) =>
    api.git(r, ["config", ...(global ? ["--global"] : []), key, value]),

  resolveRev: (r: string, rev: string) => api.git(r, ["rev-parse", "--verify", "-q", `${rev}^{commit}`]).then((s) => s.trim()),
  gc: (r: string) => api.git(r, ["gc"]),
  formatPatch: (r: string, hash: string, outDir: string) => api.git(r, ["format-patch", "-1", hash, "-o", outDir]),
  applyMailbox: (r: string, file: string) => api.git(r, ["am", "--3way", file]),
};
