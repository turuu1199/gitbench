mod git;

use git::{Branch, Commit, FileChange, RepoInfo};

// Commands are `async` so Tauri runs them off the main thread and slow git
// operations (fetch/push) never freeze the UI.

#[tauri::command]
async fn open_repo(path: String) -> Result<RepoInfo, String> {
    git::open_repo(&path)
}

#[tauri::command]
async fn log(repo: String, limit: Option<u32>, all: Option<bool>) -> Result<Vec<Commit>, String> {
    git::log(&repo, limit.unwrap_or(1000), all.unwrap_or(true))
}

#[tauri::command]
async fn branches(repo: String) -> Result<Vec<Branch>, String> {
    git::branches(&repo)
}

#[tauri::command]
async fn status(repo: String) -> Result<Vec<FileChange>, String> {
    git::status(&repo)
}

#[tauri::command]
async fn diff_file(repo: String, path: String, staged: bool, untracked: bool) -> Result<String, String> {
    git::diff_file(&repo, &path, staged, untracked)
}

#[tauri::command]
async fn show_commit(repo: String, hash: String) -> Result<String, String> {
    git::show_commit(&repo, &hash)
}

#[tauri::command]
async fn stage(repo: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    git::run(&repo, &args).map(|_| ())
}

#[tauri::command]
async fn unstage(repo: String, paths: Vec<String>) -> Result<(), String> {
    let mut args = vec!["restore", "--staged", "--"];
    args.extend(paths.iter().map(String::as_str));
    git::run(&repo, &args).map(|_| ())
}

#[tauri::command]
async fn commit(repo: String, message: String, amend: bool) -> Result<String, String> {
    let mut args = vec!["commit", "-m", &message];
    if amend {
        args.push("--amend");
    }
    git::run(&repo, &args)
}

#[tauri::command]
async fn checkout(repo: String, branch: String) -> Result<String, String> {
    git::run(&repo, &["switch", &branch])
}

#[tauri::command]
async fn create_branch(repo: String, name: String, start: Option<String>) -> Result<String, String> {
    let mut args = vec!["switch", "-c", &name];
    if let Some(s) = start.as_deref() {
        args.push(s);
    }
    git::run(&repo, &args)
}

#[tauri::command]
async fn remote_op(repo: String, op: String) -> Result<String, String> {
    let args: &[&str] = match op.as_str() {
        "fetch" => &["fetch", "--all", "--prune"],
        "pull" => &["pull", "--ff-only"],
        "push" => &["push"],
        _ => return Err(format!("unknown remote op: {op}")),
    };
    git::run(&repo, args)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            open_repo,
            log,
            branches,
            status,
            diff_file,
            show_commit,
            stage,
            unstage,
            commit,
            checkout,
            create_branch,
            remote_op
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
