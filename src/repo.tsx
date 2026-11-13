import { createContext, useContext } from "react";
import type { Branch, Commit, FileChange, Remote, RepoInfo, Stash, Submodule, Tag } from "./api";

/** Pseudo revisions shown on top of the revision grid. */
export const WORKTREE = "::worktree";
export const INDEX = "::index";

export interface RepoData {
  info: RepoInfo;
  commits: Commit[];
  branches: Branch[];
  tags: Tag[];
  remotes: Remote[];
  stashes: Stash[];
  submodules: Submodule[];
  status: FileChange[];
}

export interface Actions {
  refresh: () => Promise<void>;
  /** Run a git operation, show progress in the status bar, refresh after. */
  run: (label: string, fn: () => Promise<unknown>, opts?: { quiet?: boolean; noRefresh?: boolean }) => Promise<boolean>;
  select: (hash: string, add?: boolean) => void;
  openCommitDialog: () => void;
  openConflicts: () => void;
  openFileHistory: (path: string, rev?: string) => void;

  checkoutBranch: (name: string) => void;
  checkoutRemoteBranch: (name: string) => void;
  checkoutRevision: (hash: string) => void;
  createBranch: (at: string) => void;
  renameBranch: (name: string) => void;
  deleteBranch: (name: string) => void;
  deleteRemoteBranch: (name: string) => void;
  setUpstream: (branch: string) => void;
  merge: (rev: string) => void;
  rebase: (rev: string) => void;
  cherryPick: (c: Commit) => void;
  revert: (c: Commit) => void;
  reset: (hash: string) => void;
  createTag: (hash: string) => void;
  deleteTag: (name: string) => void;
  pushTag: (name: string) => void;

  stash: () => void;
  stashPop: (name?: string) => void;
  stashApply: (name: string) => void;
  stashDrop: (name: string) => void;

  fetch: (remote?: string) => void;
  pull: (mode?: "merge" | "rebase" | "ff-only") => void;
  push: (dialog?: boolean) => void;

  addRemote: () => void;
  editRemote: (name: string) => void;
  removeRemote: (name: string) => void;
  submoduleUpdate: (path?: string) => void;
  openSubmodule: (path: string) => void;

  sequencer: (action: "continue" | "abort" | "skip") => void;
  gotoCommit: () => void;
}

export interface RepoCtx {
  data: RepoData;
  actions: Actions;
  selected: string[];
}

export const RepoContext = createContext<RepoCtx | null>(null);

export function useRepo() {
  const ctx = useContext(RepoContext);
  if (!ctx) throw new Error("useRepo outside RepoContext");
  return ctx;
}

/** Local branch name without the remote prefix (origin/feature/x -> feature/x). */
export function stripRemote(name: string, remotes: Remote[]) {
  for (const r of remotes) if (name.startsWith(r.name + "/")) return name.slice(r.name.length + 1);
  return name.split("/").slice(1).join("/") || name;
}
