//! Thin wrapper around the `git` command-line tool.
//!
//! We shell out to the user's installed `git` so behaviour, config, hooks and
//! credentials match the command line exactly.

use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const FIELD: char = '\u{1f}';
const RECORD: char = '\u{1e}';
/// Largest file we will send to the UI for viewing.
const MAX_VIEW_BYTES: usize = 4 * 1024 * 1024;

fn command(repo: &str, args: &[&str]) -> Command {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        // Keep paths readable (no octal escaping of non-ASCII names).
        .args(["-c", "core.quotepath=false"])
        .args(args)
        // Never block waiting for a username/password on a hidden terminal.
        .env("GIT_TERMINAL_PROMPT", "0")
        // Never open an editor (merge/revert/rebase --continue messages).
        .env("GIT_EDITOR", "true")
        .env("LC_ALL", "C");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd
}

fn run_raw(repo: &str, args: &[&str]) -> Result<Output, String> {
    command(repo, args)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("failed to run git: {e}"))
}

fn error_text(out: &Output) -> String {
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let msg = format!("{}\n{}", stdout.trim(), stderr.trim());
    let msg = msg.trim();
    if msg.is_empty() {
        format!("git exited with {}", out.status)
    } else {
        msg.to_string()
    }
}

/// Run git and return stdout. On failure returns stdout + stderr as error.
pub fn run(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = run_raw(repo, args)?;
    if !out.status.success() {
        return Err(error_text(&out));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Run git and return stdout + stderr (many porcelain commands such as push
/// and fetch report progress on stderr).
pub fn run_combined(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = run_raw(repo, args)?;
    if !out.status.success() {
        return Err(error_text(&out));
    }
    let mut s = String::from_utf8_lossy(&out.stdout).into_owned();
    let err = String::from_utf8_lossy(&out.stderr);
    if !err.trim().is_empty() {
        if !s.is_empty() && !s.ends_with('\n') {
            s.push('\n');
        }
        s.push_str(&err);
    }
    Ok(s)
}

/// Run git feeding `input` on stdin (used for `git apply`).
pub fn run_stdin(repo: &str, args: &[&str], input: &str) -> Result<String, String> {
    let mut child = command(repo, args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run git: {e}"))?;
    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(error_text(&out));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

// ---------------------------------------------------------------- repo

#[derive(Serialize)]
pub struct RepoInfo {
    pub root: String,
    pub head: String,
    /// Full hash of HEAD, empty for an unborn branch.
    pub head_hash: String,
    /// "", "merging", "rebasing", "cherry-picking" or "reverting".
    pub state: String,
}

pub fn open_repo(path: &str) -> Result<RepoInfo, String> {
    if !Path::new(path).exists() {
        return Err(format!("path does not exist: {path}"));
    }
    let root = run(path, &["rev-parse", "--show-toplevel"])
        .map_err(|_| format!("not a git repository: {path}"))?
        .trim()
        .to_string();
    let head = current_branch(&root)?;
    let head_hash = run(&root, &["rev-parse", "-q", "--verify", "HEAD"])
        .unwrap_or_default()
        .trim()
        .to_string();
    let state = repo_state(&root);
    Ok(RepoInfo { root, head, head_hash, state })
}

fn repo_state(repo: &str) -> String {
    let exists = |p: &str| {
        run(repo, &["rev-parse", "--git-path", p])
            // `join` keeps `s` unchanged when git returns an absolute path.
            .map(|s| Path::new(repo).join(s.trim()).exists())
            .unwrap_or(false)
    };
    if exists("rebase-merge") || exists("rebase-apply") {
        "rebasing".into()
    } else if exists("MERGE_HEAD") {
        "merging".into()
    } else if exists("CHERRY_PICK_HEAD") {
        "cherry-picking".into()
    } else if exists("REVERT_HEAD") {
        "reverting".into()
    } else {
        String::new()
    }
}

pub fn current_branch(repo: &str) -> Result<String, String> {
    match run(repo, &["symbolic-ref", "--short", "-q", "HEAD"]) {
        Ok(s) if !s.trim().is_empty() => Ok(s.trim().to_string()),
        _ => Ok(format!(
            "(detached {})",
            run(repo, &["rev-parse", "--short", "HEAD"]).unwrap_or_default().trim()
        )),
    }
}

pub fn init_repo(path: &str, bare: bool) -> Result<String, String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())?;
    let mut args = vec!["init"];
    if bare {
        args.push("--bare");
    }
    run_combined(path, &args)
}

pub fn clone_repo(url: &str, dest: &str) -> Result<String, String> {
    let dest_path = Path::new(dest);
    let parent = dest_path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or("destination must be an absolute path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    run_combined(parent.to_str().ok_or("bad path")?, &["clone", "--progress", "--", url, dest])
}

// ---------------------------------------------------------------- log

#[derive(Serialize)]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub refs: Vec<String>,
    pub subject: String,
}

pub struct LogOptions<'a> {
    pub limit: u32,
    pub all: bool,
    pub path: Option<&'a str>,
    pub rev: Option<&'a str>,
}

pub fn log(repo: &str, opts: LogOptions) -> Result<Vec<Commit>, String> {
    let fmt = "--pretty=format:%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e";
    let n = format!("-n{}", opts.limit);
    let mut args = vec!["log", &n, fmt];
    if opts.path.is_none() {
        args.push("--topo-order");
    }
    if opts.all && opts.path.is_none() && opts.rev.is_none() {
        // Stashes are listed in the left panel, not in the history graph.
        args.extend(["--exclude=refs/stash", "--all"]);
    }
    if let Some(rev) = opts.rev {
        args.push(rev);
    }
    if let Some(p) = opts.path {
        args.extend(["--follow", "--", p]);
    }
    let out = match run(repo, &args) {
        Ok(o) => o,
        // Fresh repo with no commits yet.
        Err(e) if e.contains("does not have any commits") || e.contains("bad default revision") => {
            return Ok(vec![]);
        }
        Err(e) => return Err(e),
    };
    Ok(out
        .split(RECORD)
        .map(|r| r.trim_start_matches('\n'))
        .filter(|r| !r.is_empty())
        .filter_map(|r| {
            let p: Vec<&str> = r.split(FIELD).collect();
            if p.len() < 8 {
                return None;
            }
            Some(Commit {
                hash: p[0].into(),
                short: p[1].into(),
                parents: p[2].split_whitespace().map(String::from).collect(),
                author: p[3].into(),
                email: p[4].into(),
                time: p[5].parse().unwrap_or(0),
                refs: p[6]
                    .split(", ")
                    .filter(|s| !s.is_empty())
                    .map(String::from)
                    .collect(),
                subject: p[7].into(),
            })
        })
        .collect())
}

#[derive(Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    pub message: String,
    pub branches: Vec<String>,
    pub tags: Vec<String>,
}

pub fn commit_info(repo: &str, hash: &str) -> Result<CommitInfo, String> {
    let out = run(
        repo,
        &["show", "-s", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%B", hash],
    )?;
    let p: Vec<&str> = out.splitn(9, FIELD).collect();
    if p.len() < 9 {
        return Err("unexpected git show output".into());
    }
    let list = |args: &[&str]| -> Vec<String> {
        run(repo, args)
            .unwrap_or_default()
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .take(50)
            .collect()
    };
    Ok(CommitInfo {
        hash: p[0].into(),
        parents: p[1].split_whitespace().map(String::from).collect(),
        author: p[2].into(),
        author_email: p[3].into(),
        author_time: p[4].parse().unwrap_or(0),
        committer: p[5].into(),
        committer_email: p[6].into(),
        commit_time: p[7].parse().unwrap_or(0),
        message: p[8].trim_end().into(),
        branches: list(&["branch", "-a", "--format=%(refname:short)", "--contains", hash]),
        tags: list(&["tag", "--contains", hash]),
    })
}

// ---------------------------------------------------------------- refs

#[derive(Serialize)]
pub struct Branch {
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub hash: String,
    pub upstream: String,
    pub track: String,
}

pub fn branches(repo: &str) -> Result<Vec<Branch>, String> {
    let fmt = "--format=%(HEAD)%1f%(refname)%1f%(refname:short)%1f%(objectname)%1f%(upstream:short)%1f%(upstream:track)";
    let out = run(repo, &["for-each-ref", fmt, "refs/heads", "refs/remotes"])?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split(FIELD).collect();
            if p.len() < 6 || p[1].ends_with("/HEAD") {
                return None;
            }
            Some(Branch {
                current: p[0] == "*",
                remote: p[1].starts_with("refs/remotes/"),
                name: p[2].into(),
                hash: p[3].into(),
                upstream: p[4].into(),
                track: p[5].into(),
            })
        })
        .collect())
}

#[derive(Serialize)]
pub struct Tag {
    pub name: String,
    /// Commit the tag points at (peeled for annotated tags).
    pub hash: String,
}

pub fn tags(repo: &str) -> Result<Vec<Tag>, String> {
    let out = run(
        repo,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:short)%1f%(objectname)%1f%(*objectname)",
            "refs/tags",
        ],
    )?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split(FIELD).collect();
            if p.len() < 3 {
                return None;
            }
            let hash = if p[2].is_empty() { p[1] } else { p[2] };
            Some(Tag { name: p[0].into(), hash: hash.into() })
        })
        .collect())
}

#[derive(Serialize)]
pub struct Remote {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

pub fn remotes(repo: &str) -> Result<Vec<Remote>, String> {
    let out = run(repo, &["remote", "-v"])?;
    let mut list: Vec<Remote> = vec![];
    for line in out.lines() {
        let mut parts = line.split_whitespace();
        let (Some(name), Some(url), Some(kind)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        let idx = match list.iter().position(|r| r.name == name) {
            Some(i) => i,
            None => {
                list.push(Remote { name: name.into(), fetch_url: String::new(), push_url: String::new() });
                list.len() - 1
            }
        };
        if kind == "(push)" {
            list[idx].push_url = url.into();
        } else {
            list[idx].fetch_url = url.into();
        }
    }
    Ok(list)
}

#[derive(Serialize)]
pub struct Stash {
    pub name: String,
    pub hash: String,
    pub message: String,
}

pub fn stashes(repo: &str) -> Result<Vec<Stash>, String> {
    let out = run(repo, &["stash", "list", "--format=%gd%x1f%H%x1f%gs"])?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split(FIELD).collect();
            (p.len() >= 3).then(|| Stash { name: p[0].into(), hash: p[1].into(), message: p[2].into() })
        })
        .collect())
}

#[derive(Serialize)]
pub struct Submodule {
    pub path: String,
    pub hash: String,
    /// ' ' up to date, '+' different commit checked out, '-' not initialised, 'U' conflict.
    pub status: char,
}

pub fn submodules(repo: &str) -> Result<Vec<Submodule>, String> {
    let out = run(repo, &["submodule", "status"]).unwrap_or_default();
    Ok(out
        .lines()
        .filter_map(|l| {
            let status = l.chars().next()?;
            let mut rest = l[1..].split_whitespace();
            let hash = rest.next()?.to_string();
            let path = rest.next()?.to_string();
            Some(Submodule { path, hash, status })
        })
        .collect())
}

// ---------------------------------------------------------------- changes

#[derive(Serialize)]
pub struct FileChange {
    pub path: String,
    pub orig_path: Option<String>,
    /// Index (staged) status letter, ' ' if none.
    pub index: char,
    /// Worktree (unstaged) status letter, ' ' if none.
    pub worktree: char,
}

pub fn status(repo: &str) -> Result<Vec<FileChange>, String> {
    let out = run(repo, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    let mut parts = out.split('\0').filter(|s| !s.is_empty());
    let mut files = vec![];
    while let Some(entry) = parts.next() {
        if entry.len() < 4 {
            continue;
        }
        let mut chars = entry.chars();
        let index = chars.next().unwrap_or(' ');
        let worktree = chars.next().unwrap_or(' ');
        let path = entry[3..].to_string();
        // Renames/copies are followed by the original path.
        let orig_path = if matches!(index, 'R' | 'C') {
            parts.next().map(String::from)
        } else {
            None
        };
        files.push(FileChange { path, orig_path, index, worktree });
    }
    Ok(files)
}

#[derive(Serialize)]
pub struct ChangedFile {
    pub path: String,
    pub orig_path: Option<String>,
    pub status: char,
}

/// Files changed between `base` and `hash`. With no base, the commit is
/// treated as a root commit (compared with the empty tree).
pub fn commit_files(repo: &str, hash: &str, base: Option<&str>) -> Result<Vec<ChangedFile>, String> {
    let out = match base {
        Some(b) => run(repo, &["diff", "--name-status", "-z", "-M", b, hash])?,
        None => run(repo, &["diff-tree", "-r", "--root", "--no-commit-id", "--name-status", "-z", "-M", hash])?,
    };
    let mut parts = out.split('\0').filter(|s| !s.is_empty());
    let mut files = vec![];
    while let Some(code) = parts.next() {
        let status = code.chars().next().unwrap_or('M');
        let first = parts.next().unwrap_or_default().to_string();
        if matches!(status, 'R' | 'C') {
            let second = parts.next().unwrap_or_default().to_string();
            files.push(ChangedFile { path: second, orig_path: Some(first), status });
        } else {
            files.push(ChangedFile { path: first, orig_path: None, status });
        }
    }
    Ok(files)
}

pub fn diff_commit_file(
    repo: &str,
    hash: &str,
    base: Option<&str>,
    path: &str,
    orig_path: Option<&str>,
) -> Result<String, String> {
    let mut args: Vec<&str> = match base {
        Some(b) => vec!["diff", "-M", b, hash, "--"],
        None => vec!["show", "--format=", "--patch", hash, "--"],
    };
    if let Some(o) = orig_path {
        args.push(o);
    }
    args.push(path);
    run(repo, &args)
}

pub fn diff_file(repo: &str, path: &str, staged: bool, untracked: bool) -> Result<String, String> {
    if untracked {
        // `git diff --no-index` exits 1 when files differ, so read output directly.
        let out = run_raw(repo, &["diff", "--no-index", "--", "/dev/null", path])?;
        return Ok(String::from_utf8_lossy(&out.stdout).into_owned());
    }
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.extend(["--", path]);
    run(repo, &args)
}

pub fn show_commit(repo: &str, hash: &str) -> Result<String, String> {
    run(
        repo,
        &["show", "--stat", "--patch", "--format=commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n%B", hash],
    )
}

// ---------------------------------------------------------------- files

pub fn ls_tree(repo: &str, hash: &str) -> Result<Vec<String>, String> {
    let out = run(repo, &["ls-tree", "-r", "-z", "--name-only", hash])?;
    Ok(out.split('\0').filter(|s| !s.is_empty()).map(String::from).collect())
}

pub fn file_at(repo: &str, hash: &str, path: &str) -> Result<String, String> {
    let spec = format!("{hash}:{path}");
    let out = run_raw(repo, &["show", &spec])?;
    if !out.status.success() {
        return Err(error_text(&out));
    }
    if out.stdout.len() > MAX_VIEW_BYTES {
        return Ok(format!("(file too large to show: {} bytes)", out.stdout.len()));
    }
    if out.stdout.iter().take(8000).any(|&b| b == 0) {
        return Ok("(binary file)".into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[derive(Serialize)]
pub struct BlameLine {
    pub hash: String,
    pub author: String,
    pub time: i64,
    pub summary: String,
    pub line: String,
}

pub fn blame(repo: &str, hash: Option<&str>, path: &str) -> Result<Vec<BlameLine>, String> {
    let mut args = vec!["blame", "--porcelain"];
    if let Some(h) = hash {
        args.push(h);
    }
    args.extend(["--", path]);
    let out = run(repo, &args)?;

    struct Meta {
        author: String,
        time: i64,
        summary: String,
    }
    let mut meta: std::collections::HashMap<String, Meta> = Default::default();
    let mut lines = vec![];
    let mut current = String::new();
    for l in out.lines() {
        if let Some(content) = l.strip_prefix('\t') {
            let m = meta.get(&current);
            lines.push(BlameLine {
                hash: current.clone(),
                author: m.map(|m| m.author.clone()).unwrap_or_default(),
                time: m.map(|m| m.time).unwrap_or(0),
                summary: m.map(|m| m.summary.clone()).unwrap_or_default(),
                line: content.to_string(),
            });
            continue;
        }
        let (key, val) = l.split_once(' ').unwrap_or((l, ""));
        if (key.len() == 40 || key.len() == 64) && key.chars().all(|c| c.is_ascii_hexdigit()) {
            current = key.to_string();
            meta.entry(current.clone()).or_insert(Meta { author: String::new(), time: 0, summary: String::new() });
        } else if let Some(m) = meta.get_mut(&current) {
            match key {
                "author" => m.author = val.to_string(),
                "author-time" => m.time = val.parse().unwrap_or(0),
                "summary" => m.summary = val.to_string(),
                _ => {}
            }
        }
    }
    Ok(lines)
}

/// Append a pattern line to `<repo root>/.gitignore`.
pub fn append_gitignore(repo: &str, pattern: &str) -> Result<(), String> {
    let pattern = pattern.trim();
    if pattern.is_empty() || pattern.contains('\n') {
        return Err("invalid pattern".into());
    }
    let root = run(repo, &["rev-parse", "--show-toplevel"])?.trim().to_string();
    let file = Path::new(&root).join(".gitignore");
    let current = std::fs::read_to_string(&file).unwrap_or_default();
    if current.lines().any(|l| l.trim() == pattern) {
        return Ok(());
    }
    let mut out = current;
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(pattern);
    out.push('\n');
    std::fs::write(&file, out).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    struct TempRepo(PathBuf);
    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    impl TempRepo {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("gitbench-test-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            let r = TempRepo(dir);
            r.git(&["init", "-q", "-b", "main"]);
            r.git(&["config", "user.name", "Test User"]);
            r.git(&["config", "user.email", "test@example.com"]);
            r.git(&["config", "commit.gpgsign", "false"]);
            r.git(&["config", "tag.gpgsign", "false"]);
            r
        }
        fn path(&self) -> &str {
            self.0.to_str().unwrap()
        }
        fn git(&self, args: &[&str]) -> String {
            run(self.path(), args).unwrap()
        }
        fn write(&self, file: &str, body: &str) {
            fs::write(self.0.join(file), body).unwrap();
        }
        fn commit(&self, file: &str, body: &str, msg: &str) {
            self.write(file, body);
            self.git(&["add", "."]);
            self.git(&["commit", "-q", "-m", msg]);
        }
    }

    fn all(r: &TempRepo) -> Vec<Commit> {
        log(r.path(), LogOptions { limit: 100, all: true, path: None, rev: None }).unwrap()
    }

    #[test]
    fn empty_repo_has_no_commits() {
        let r = TempRepo::new("empty");
        assert!(all(&r).is_empty());
        let info = open_repo(r.path()).unwrap();
        assert_eq!(info.head, "main");
        assert_eq!(info.head_hash, "");
        assert_eq!(info.state, "");
    }

    #[test]
    fn not_a_repo_errors() {
        let missing = std::env::temp_dir().join("gitbench-definitely-missing");
        assert!(open_repo(missing.to_str().unwrap()).is_err());
    }

    #[test]
    fn log_parses_commits_refs_and_special_subjects() {
        let r = TempRepo::new("log");
        r.commit("a.txt", "one\n", "first, with comma | pipe");
        r.git(&["tag", "v1"]);
        r.commit("a.txt", "two\n", "second");

        let commits = all(&r);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "second");
        assert_eq!(commits[0].author, "Test User");
        assert!(commits[0].refs.iter().any(|x| x == "HEAD -> main"));
        assert_eq!(commits[1].subject, "first, with comma | pipe");
        assert!(commits[1].parents.is_empty());
        assert!(commits[1].refs.iter().any(|x| x == "tag: v1"));
        assert_eq!(commits[0].parents[0], commits[1].hash);
    }

    #[test]
    fn file_history_follows_path() {
        let r = TempRepo::new("history");
        r.commit("a.txt", "1\n", "a1");
        r.commit("b.txt", "1\n", "b1");
        r.commit("a.txt", "2\n", "a2");
        let h = log(r.path(), LogOptions { limit: 10, all: false, path: Some("a.txt"), rev: None }).unwrap();
        let subjects: Vec<_> = h.iter().map(|c| c.subject.as_str()).collect();
        assert_eq!(subjects, ["a2", "a1"]);
    }

    #[test]
    fn refs_tags_stashes_remotes() {
        let r = TempRepo::new("refs");
        r.commit("a.txt", "x\n", "init");
        r.git(&["branch", "feature/x"]);
        r.git(&["tag", "-a", "v1", "-m", "release"]);
        r.git(&["tag", "light"]);
        r.git(&["remote", "add", "origin", "https://example.com/repo.git"]);
        r.write("a.txt", "dirty\n");
        r.git(&["stash", "push", "-m", "wip stuff"]);
        assert_eq!(all(&r).len(), 1, "stash commits must not appear in the log");

        let b = branches(r.path()).unwrap();
        assert_eq!(b.len(), 2);
        assert!(b.iter().any(|b| b.name == "main" && b.current && !b.remote && b.hash.len() >= 40));

        let head = r.git(&["rev-parse", "HEAD"]).trim().to_string();
        let t = tags(r.path()).unwrap();
        assert_eq!(t.len(), 2);
        assert!(t.iter().all(|t| t.hash == head), "annotated tag must be peeled");

        let s = stashes(r.path()).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].name, "stash@{0}");
        assert!(s[0].message.contains("wip stuff"));

        let rm = remotes(r.path()).unwrap();
        assert_eq!(rm.len(), 1);
        assert_eq!(rm[0].fetch_url, "https://example.com/repo.git");
        assert!(submodules(r.path()).unwrap().is_empty());
    }

    #[test]
    fn status_handles_modified_untracked_rename_and_spaces() {
        let r = TempRepo::new("status");
        r.write("keep.txt", "k\n");
        r.commit("old name.txt", "rename me\n", "init");

        r.write("keep.txt", "changed\n");
        r.write("new file.txt", "new\n");
        r.git(&["mv", "old name.txt", "new name.txt"]);

        let s = status(r.path()).unwrap();
        let find = |p: &str| s.iter().find(|f| f.path == p).unwrap();
        assert_eq!((find("keep.txt").index, find("keep.txt").worktree), (' ', 'M'));
        assert_eq!((find("new file.txt").index, find("new file.txt").worktree), ('?', '?'));
        let rn = find("new name.txt");
        assert_eq!(rn.index, 'R');
        assert_eq!(rn.orig_path.as_deref(), Some("old name.txt"));
        assert_eq!(s.len(), 3);
    }

    #[test]
    fn commit_files_and_diffs() {
        let r = TempRepo::new("cfiles");
        r.commit("a.txt", "one\n", "init");
        let root = r.git(&["rev-parse", "HEAD"]).trim().to_string();
        let f = commit_files(r.path(), &root, None).unwrap();
        assert_eq!(f.len(), 1);
        assert_eq!((f[0].path.as_str(), f[0].status), ("a.txt", 'A'));
        assert!(diff_commit_file(r.path(), &root, None, "a.txt", None).unwrap().contains("+one"));

        r.git(&["mv", "a.txt", "b.txt"]);
        r.commit("c.txt", "c\n", "rename + add");
        let head = r.git(&["rev-parse", "HEAD"]).trim().to_string();
        let f = commit_files(r.path(), &head, Some(&root)).unwrap();
        let rn = f.iter().find(|x| x.status == 'R').unwrap();
        assert_eq!((rn.path.as_str(), rn.orig_path.as_deref()), ("b.txt", Some("a.txt")));
        assert!(f.iter().any(|x| x.path == "c.txt" && x.status == 'A'));

        let info = commit_info(r.path(), &head).unwrap();
        assert_eq!(info.message, "rename + add");
        assert_eq!(info.parents, vec![root.clone()]);
        assert!(info.branches.contains(&"main".to_string()));

        assert_eq!(ls_tree(r.path(), &head).unwrap(), vec!["b.txt", "c.txt"]);
        assert_eq!(file_at(r.path(), &head, "b.txt").unwrap(), "one\n");

        let bl = blame(r.path(), Some(&head), "b.txt").unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].hash, root);
        assert_eq!(bl[0].author, "Test User");
        assert_eq!(bl[0].line, "one");
    }

    #[test]
    fn working_tree_diffs_and_partial_apply() {
        let r = TempRepo::new("diff");
        r.commit("a.txt", "one\ntwo\n", "init");

        r.write("a.txt", "ONE\nTWO\n");
        let d = diff_file(r.path(), "a.txt", false, false).unwrap();
        assert!(d.contains("-one") && d.contains("+TWO"));

        // Stage only the first line change (what line staging produces).
        let patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n-one\n+ONE\n two\n";
        run_stdin(r.path(), &["apply", "--cached", "--recount", "-"], patch).unwrap();
        let staged = diff_file(r.path(), "a.txt", true, false).unwrap();
        assert!(staged.contains("+ONE") && !staged.contains("+TWO"));

        r.write("b.txt", "brand new\n");
        assert!(diff_file(r.path(), "b.txt", false, true).unwrap().contains("+brand new"));
    }

    #[test]
    fn merge_conflict_state() {
        let r = TempRepo::new("merge");
        r.commit("a.txt", "base\n", "init");
        r.git(&["switch", "-q", "-c", "other"]);
        r.commit("a.txt", "theirs\n", "other");
        r.git(&["switch", "-q", "main"]);
        r.commit("a.txt", "ours\n", "main");
        assert!(run(r.path(), &["merge", "other"]).is_err());
        assert_eq!(open_repo(r.path()).unwrap().state, "merging");
        let s = status(r.path()).unwrap();
        assert_eq!((s[0].index, s[0].worktree), ('U', 'U'));
        r.git(&["merge", "--abort"]);
        assert_eq!(open_repo(r.path()).unwrap().state, "");
    }

    #[test]
    fn gitignore_append() {
        let r = TempRepo::new("ignore");
        r.write("junk.log", "x");
        append_gitignore(r.path(), "/junk.log").unwrap();
        append_gitignore(r.path(), "/junk.log").unwrap();
        assert_eq!(fs::read_to_string(r.0.join(".gitignore")).unwrap(), "/junk.log\n");
        assert!(status(r.path()).unwrap().iter().all(|f| f.path != "junk.log"));
        assert!(append_gitignore(r.path(), "a\nb").is_err());
    }

    #[test]
    fn init_and_clone() {
        let base = std::env::temp_dir().join(format!("gitbench-test-clone-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let src = base.join("src");
        init_repo(src.to_str().unwrap(), false).unwrap();
        let s = src.to_str().unwrap();
        run(s, &["-c", "user.name=T", "-c", "user.email=t@e", "commit", "-q", "--allow-empty", "-m", "x"]).unwrap();
        let dst = base.join("nested").join("dst");
        clone_repo(s, dst.to_str().unwrap()).unwrap();
        assert_eq!(log(dst.to_str().unwrap(), LogOptions { limit: 5, all: false, path: None, rev: None }).unwrap().len(), 1);
        let _ = fs::remove_dir_all(&base);
    }
}
