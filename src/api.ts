import { invoke } from "@tauri-apps/api/core";

export interface RepoInfo {
  root: string;
  head: string;
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

export interface Branch {
  name: string;
  remote: boolean;
  current: boolean;
  upstream: string;
  track: string;
}

export interface FileChange {
  path: string;
  orig_path: string | null;
  index: string;
  worktree: string;
}

export const api = {
  openRepo: (path: string) => invoke<RepoInfo>("open_repo", { path }),
  log: (repo: string, limit = 1000, all = true) =>
    invoke<Commit[]>("log", { repo, limit, all }),
  branches: (repo: string) => invoke<Branch[]>("branches", { repo }),
  status: (repo: string) => invoke<FileChange[]>("status", { repo }),
  diffFile: (repo: string, path: string, staged: boolean, untracked: boolean) =>
    invoke<string>("diff_file", { repo, path, staged, untracked }),
  showCommit: (repo: string, hash: string) =>
    invoke<string>("show_commit", { repo, hash }),
  stage: (repo: string, paths: string[]) => invoke<void>("stage", { repo, paths }),
  unstage: (repo: string, paths: string[]) =>
    invoke<void>("unstage", { repo, paths }),
  commit: (repo: string, message: string, amend = false) =>
    invoke<string>("commit", { repo, message, amend }),
  checkout: (repo: string, branch: string) =>
    invoke<string>("checkout", { repo, branch }),
  createBranch: (repo: string, name: string, start?: string) =>
    invoke<string>("create_branch", { repo, name, start }),
  remoteOp: (repo: string, op: "fetch" | "pull" | "push") =>
    invoke<string>("remote_op", { repo, op }),
};
