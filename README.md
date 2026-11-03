# gitbench

Cross-platform Git GUI for **Windows, macOS and Linux**. Its workflow and layout
follow [Git Extensions](https://github.com/gitextensions/gitextensions), which only
runs on Windows. gitbench is a separate implementation: none of Git Extensions'
code, icons or branding are used.

Built with [Tauri 2](https://tauri.app) (Rust) + React + TypeScript. The backend
runs your installed `git`, so config, hooks and credentials work the same as on
the command line.

## Features

**Dashboard**: open, clone, or create a repository. Recent repositories can be pinned.

**Browse window**: the same layout as Git Extensions.
- Menu bar: Start, Repository, Navigate, View, Commands, Help.
- Toolbar:
  - repository and branch dropdowns, refresh
  - Stash ▾, Commit (N)
  - Pull ▾ (merge / rebase / fast-forward only), Fetch, Push ▾
  - Console button and a filter box
- Left panel: tree of branches (grouped by folder), remotes, tags, submodules and
  stashes. Every item has a right-click menu.
- Revision grid:
  - branch graph with labels for branches, remote branches and tags
  - *Working directory* and *Commit index* rows at the top
  - quick search (type in the list), keyboard navigation
  - Ctrl/⌘+click a second commit to compare two commits
- Commit right-click menu:
  - create branch, checkout branch or commit
  - merge, rebase, reset (soft / mixed / hard)
  - create or delete tags, rename or delete branches
  - cherry-pick, revert (merge commits too)
  - copy to clipboard
- Bottom tabs:
  - **Commit**: author, committer, parents, message, and which branches and tags contain the commit
  - **Diff**: changed files plus a Diff / Blame / View switch
  - **File tree**: all files at the selected commit, with a filter, View and Blame
  - **Console**: run any git command

**Commit dialog**
- Unstaged changes top-left, staged changes bottom-left, diff on the right, message bottom-right.
- Stage, unstage or reset a file, a **hunk** or **single lines**. Keys: S / U / R, or right-click.
- Amend (fills in the last message), reset author, skip hooks.
- Commit, or Commit & push.
- Add a file to `.gitignore`. Your unsent message is kept as a draft.

**Merge conflicts**
- A banner shows while a merge, rebase, cherry-pick or revert is in progress, with
  Continue / Skip / Abort buttons.
- In the commit dialog, resolve a file with ours / theirs, or mark it resolved.

**More**
- File history (Diff / Blame / View)
- Go to commit (⌘/Ctrl+Shift+G)
- Manage remotes, user name / email, submodule update
- `gc` and `fsck`
- Format patch / apply patch
- Light and dark theme (follows the OS)
- Resizable panels that remember their size

### Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Commit dialog | ⌘K / Ctrl+K, or Ctrl+Space |
| Refresh | F5, ⌘/Ctrl+R |
| Go to commit | ⌘/Ctrl+Shift+G |
| Filter history | ⌘/Ctrl+F |
| Create branch at selected commit | ⌘/Ctrl+B |
| Stage / Unstage / Reset (commit dialog) | S / U / R |
| Commit (commit dialog) | ⌘/Ctrl+Enter |

## Roadmap

- [ ] Interactive rebase (reorder / squash / reword)
- [ ] Worktrees panel
- [ ] Reflog view, advanced log filter
- [ ] Settings dialog (fonts, columns, external diff and merge tools)
- [ ] GitHub integration (pull requests)
- [ ] Spell checker and commit templates
- [ ] Installers built by CI for all three OSes

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

## Tests

```sh
npm test          # partial-patch + graph tests (against real git) and Rust backend tests
```

To test the UI in a normal browser, use the dev-only HTTP bridge. It only accepts
requests from the Vite dev server origin, so it is safe to run locally, but never ship it.

```sh
cd src-tauri && cargo run --example bridge   # 127.0.0.1:1421
npx vite --port 1420                         # then route window.__TAURI_INTERNALS__.invoke to the bridge
```

## Build installers

```sh
npm run tauri build
```

The installers land in `src-tauri/target/release/bundle/`:
- Windows: `.msi` / `.exe`
- macOS: `.dmg` / `.app`
- Linux: `.deb` / `.AppImage` / `.rpm`

## Project layout

```
src/
  App.tsx              main window: menu bar, toolbar, all git actions, layout
  repo.tsx             shared repo state/context
  api.ts               typed backend calls + git write operations
  lib/graph.ts         revision graph lane layout
  lib/patch.ts         diff parsing + partial (line/hunk) patch builder
  components/          RevisionGrid, Sidebar, BottomPanel, CommitDialog, FileHistory, Dashboard, DiffView
  components/ui/       ContextMenu, MenuBar, Dialogs, Splitter, ErrorBoundary
src-tauri/src/
  git.rs               git CLI wrapper + output parsing (+ tests)
  lib.rs               Tauri commands
src-tauri/examples/
  bridge.rs            dev-only HTTP bridge for browser UI testing
tests/lib.test.mjs     partial staging + graph tests
```

## License

[MIT](LICENSE) © 2026 turmandakh

gitbench is an independent project and is not affiliated with Git Extensions.
