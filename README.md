# gitbench

Cross-platform Git GUI for **Windows, macOS and Linux**, inspired by
[Git Extensions](https://github.com/gitextensions/gitextensions) (which is Windows-only).

Built with [Tauri 2](https://tauri.app) (Rust) + React + TypeScript. The backend
shells out to your installed `git`, so config, hooks and credentials behave the
same as on the command line.

## Features (v0.1)

- Open repository (folder picker) + recent repositories
- Commit history (all branches) with branch / tag / remote labels, filter box
- Commit details: message, stat and full diff
- Branch list; double-click to checkout; create new branch
- Commit dialog: unstaged / staged lists, stage / unstage (double-click or "all"),
  per-file diff, commit, amend
- Fetch / Pull (`--ff-only`) / Push
- Light and dark theme (follows OS)

## Roadmap

- [ ] Commit graph lanes
- [ ] Hunk / line staging
- [ ] Merge, rebase, cherry-pick, revert, reset
- [ ] Stash manager
- [ ] Tags and remotes management
- [ ] Blame and file history
- [ ] Submodules / worktrees
- [ ] Settings, keyboard shortcuts, external diff/merge tool

## Prerequisites

- [git](https://git-scm.com)
- [Node.js](https://nodejs.org) 20+
- [Rust](https://rustup.rs) (stable)
- OS libraries for Tauri: <https://tauri.app/start/prerequisites/>

## Develop

```sh
npm install
npm run tauri dev
```

## Build installers

```sh
npm run tauri build
```

Output in `src-tauri/target/release/bundle/` (`.msi`/`.exe` on Windows,
`.dmg`/`.app` on macOS, `.deb`/`.AppImage`/`.rpm` on Linux). Each OS must build
its own installer (or use CI, e.g. GitHub Actions with `tauri-action`).

## Project layout

```
src/                 React UI
  App.tsx            main window (toolbar, branches, log, details)
  components/        CommitDialog, Diff
  api.ts             typed calls to Rust commands
src-tauri/src/
  git.rs             git CLI wrapper + output parsing
  lib.rs             Tauri commands
```

## License

Not chosen yet. Note: Git Extensions is GPL-3.0 — if any of its code is copied
into this project, this project must also be GPL-3.0.
