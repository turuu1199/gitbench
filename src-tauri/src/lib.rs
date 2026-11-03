pub mod git;

use git::*;

// Commands are `async` so Tauri runs them off the main thread and slow git
// operations (fetch/push/clone) never freeze the UI.

type R<T> = Result<T, String>;

fn strs(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

/// Run any git command (no shell involved; arguments are passed as-is).
/// Write operations are composed on the frontend in `src/api.ts`.
#[tauri::command]
async fn git(repo: String, args: Vec<String>) -> R<String> {
    if args.is_empty() {
        return Err("no git arguments given".into());
    }
    git::run_combined(&repo, &strs(&args))
}

/// Run git with `input` on stdin (used for `git apply` of partial patches).
#[tauri::command]
async fn git_stdin(repo: String, args: Vec<String>, input: String) -> R<String> {
    git::run_stdin(&repo, &strs(&args), &input)
}

#[tauri::command]
async fn open_repo(path: String) -> R<RepoInfo> {
    git::open_repo(&path)
}

#[tauri::command]
async fn init_repo(path: String, bare: bool) -> R<String> {
    git::init_repo(&path, bare)
}

#[tauri::command]
async fn clone_repo(url: String, dest: String) -> R<String> {
    git::clone_repo(&url, &dest)
}

#[tauri::command]
async fn log(repo: String, limit: Option<u32>, all: Option<bool>, path: Option<String>, rev: Option<String>) -> R<Vec<Commit>> {
    git::log(
        &repo,
        LogOptions {
            limit: limit.unwrap_or(2000),
            all: all.unwrap_or(true),
            path: path.as_deref(),
            rev: rev.as_deref(),
        },
    )
}

#[tauri::command]
async fn commit_info(repo: String, hash: String) -> R<CommitInfo> {
    git::commit_info(&repo, &hash)
}

#[tauri::command]
async fn branches(repo: String) -> R<Vec<Branch>> {
    git::branches(&repo)
}

#[tauri::command]
async fn tags(repo: String) -> R<Vec<Tag>> {
    git::tags(&repo)
}

#[tauri::command]
async fn remotes(repo: String) -> R<Vec<Remote>> {
    git::remotes(&repo)
}

#[tauri::command]
async fn stashes(repo: String) -> R<Vec<Stash>> {
    git::stashes(&repo)
}

#[tauri::command]
async fn submodules(repo: String) -> R<Vec<Submodule>> {
    git::submodules(&repo)
}

#[tauri::command]
async fn status(repo: String) -> R<Vec<FileChange>> {
    git::status(&repo)
}

#[tauri::command]
async fn commit_files(repo: String, hash: String, base: Option<String>) -> R<Vec<ChangedFile>> {
    git::commit_files(&repo, &hash, base.as_deref())
}

#[tauri::command]
async fn diff_commit_file(repo: String, hash: String, base: Option<String>, path: String, orig_path: Option<String>) -> R<String> {
    git::diff_commit_file(&repo, &hash, base.as_deref(), &path, orig_path.as_deref())
}

#[tauri::command]
async fn diff_file(repo: String, path: String, staged: bool, untracked: bool) -> R<String> {
    git::diff_file(&repo, &path, staged, untracked)
}

#[tauri::command]
async fn show_commit(repo: String, hash: String) -> R<String> {
    git::show_commit(&repo, &hash)
}

#[tauri::command]
async fn ls_tree(repo: String, hash: String) -> R<Vec<String>> {
    git::ls_tree(&repo, &hash)
}

#[tauri::command]
async fn file_at(repo: String, hash: String, path: String) -> R<String> {
    git::file_at(&repo, &hash, &path)
}

#[tauri::command]
async fn blame(repo: String, hash: Option<String>, path: String) -> R<Vec<BlameLine>> {
    git::blame(&repo, hash.as_deref(), &path)
}

#[tauri::command]
async fn append_gitignore(repo: String, pattern: String) -> R<()> {
    git::append_gitignore(&repo, &pattern)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            git,
            git_stdin,
            open_repo,
            init_repo,
            clone_repo,
            log,
            commit_info,
            branches,
            tags,
            remotes,
            stashes,
            submodules,
            status,
            commit_files,
            diff_commit_file,
            diff_file,
            show_commit,
            ls_tree,
            file_at,
            blame,
            append_gitignore
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
