//! Thin wrapper around the `git` command-line tool.
//!
//! We shell out to the user's installed `git` (like Git Extensions does) so
//! behaviour, config, hooks and credentials match the CLI exactly.

use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const FIELD: char = '\u{1f}';
const RECORD: char = '\u{1e}';

pub fn run(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = run_raw(repo, args)?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn run_raw(repo: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(repo)
        .args(args)
        // Never block waiting for a username/password on a hidden terminal.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    cmd.output().map_err(|e| format!("failed to run git: {e}"))
}

#[derive(Serialize)]
pub struct RepoInfo {
    pub root: String,
    pub head: String,
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
    Ok(RepoInfo { root, head })
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

pub fn log(repo: &str, limit: u32, all: bool) -> Result<Vec<Commit>, String> {
    let fmt = format!(
        "--pretty=format:%H{f}%h{f}%P{f}%an{f}%ae{f}%at{f}%D{f}%s{r}",
        f = "%x1f",
        r = "%x1e"
    );
    let n = format!("-n{limit}");
    let mut args = vec!["log", "--topo-order", &n, &fmt];
    if all {
        args.push("--all");
    }
    let out = match run(repo, &args) {
        Ok(o) => o,
        // Fresh repo with no commits yet.
        Err(e) if e.contains("does not have any commits") => return Ok(vec![]),
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
pub struct Branch {
    pub name: String,
    pub remote: bool,
    pub current: bool,
    pub upstream: String,
    pub track: String,
}

pub fn branches(repo: &str) -> Result<Vec<Branch>, String> {
    let fmt = "--format=%(HEAD)%1f%(refname)%1f%(refname:short)%1f%(upstream:short)%1f%(upstream:track)";
    let out = run(repo, &["for-each-ref", fmt, "refs/heads", "refs/remotes"])?;
    Ok(out
        .lines()
        .filter_map(|l| {
            let p: Vec<&str> = l.split(FIELD).collect();
            if p.len() < 5 || p[1].ends_with("/HEAD") {
                return None;
            }
            Some(Branch {
                current: p[0] == "*",
                remote: p[1].starts_with("refs/remotes/"),
                name: p[2].into(),
                upstream: p[3].into(),
                track: p[4].into(),
            })
        })
        .collect())
}

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
        &[
            "show",
            "--stat",
            "--patch",
            "--format=commit %H%nAuthor: %an <%ae>%nDate:   %ad%n%n%B",
            hash,
        ],
    )
}

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
    }

    #[test]
    fn empty_repo_has_no_commits() {
        let r = TempRepo::new("empty");
        assert!(log(r.path(), 100, true).unwrap().is_empty());
        assert_eq!(open_repo(r.path()).unwrap().head, "main");
    }

    #[test]
    fn not_a_repo_errors() {
        let dir = std::env::temp_dir();
        let missing = dir.join("gitbench-definitely-missing");
        assert!(open_repo(missing.to_str().unwrap()).is_err());
    }

    #[test]
    fn log_parses_commits_refs_and_special_subjects() {
        let r = TempRepo::new("log");
        r.write("a.txt", "one\n");
        r.git(&["add", "."]);
        r.git(&["commit", "-q", "-m", "first, with comma | pipe"]);
        r.git(&["tag", "v1"]);
        r.write("a.txt", "two\n");
        r.git(&["commit", "-q", "-am", "second"]);

        let commits = log(r.path(), 100, true).unwrap();
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].subject, "second");
        assert_eq!(commits[0].parents.len(), 1);
        assert_eq!(commits[0].author, "Test User");
        assert!(commits[0].refs.iter().any(|x| x == "HEAD -> main"));
        assert_eq!(commits[1].subject, "first, with comma | pipe");
        assert!(commits[1].parents.is_empty());
        assert!(commits[1].refs.iter().any(|x| x == "tag: v1"));
        assert_eq!(commits[0].parents[0], commits[1].hash);
    }

    #[test]
    fn branches_list_current() {
        let r = TempRepo::new("branches");
        r.write("a.txt", "x\n");
        r.git(&["add", "."]);
        r.git(&["commit", "-q", "-m", "init"]);
        r.git(&["branch", "feature/x"]);
        let b = branches(r.path()).unwrap();
        assert_eq!(b.len(), 2);
        assert!(b.iter().any(|b| b.name == "main" && b.current && !b.remote));
        assert!(b.iter().any(|b| b.name == "feature/x" && !b.current));
    }

    #[test]
    fn status_handles_modified_untracked_rename_and_spaces() {
        let r = TempRepo::new("status");
        r.write("keep.txt", "k\n");
        r.write("old name.txt", "rename me\n");
        r.git(&["add", "."]);
        r.git(&["commit", "-q", "-m", "init"]);

        r.write("keep.txt", "changed\n");
        r.write("new file.txt", "new\n");
        r.git(&["mv", "old name.txt", "new name.txt"]);

        let s = status(r.path()).unwrap();
        let find = |p: &str| s.iter().find(|f| f.path == p).unwrap();
        let m = find("keep.txt");
        assert_eq!((m.index, m.worktree), (' ', 'M'));
        let u = find("new file.txt");
        assert_eq!((u.index, u.worktree), ('?', '?'));
        let rn = find("new name.txt");
        assert_eq!(rn.index, 'R');
        assert_eq!(rn.orig_path.as_deref(), Some("old name.txt"));
        assert_eq!(s.len(), 3);
    }

    #[test]
    fn diffs_for_unstaged_staged_untracked_and_commit() {
        let r = TempRepo::new("diff");
        r.write("a.txt", "one\n");
        r.git(&["add", "."]);
        r.git(&["commit", "-q", "-m", "init"]);

        r.write("a.txt", "two\n");
        let d = diff_file(r.path(), "a.txt", false, false).unwrap();
        assert!(d.contains("-one") && d.contains("+two"));

        r.git(&["add", "a.txt"]);
        assert!(diff_file(r.path(), "a.txt", false, false).unwrap().is_empty());
        assert!(diff_file(r.path(), "a.txt", true, false).unwrap().contains("+two"));

        r.write("b.txt", "brand new\n");
        assert!(diff_file(r.path(), "b.txt", false, true).unwrap().contains("+brand new"));

        let head = r.git(&["rev-parse", "HEAD"]);
        let show = show_commit(r.path(), head.trim()).unwrap();
        assert!(show.contains("Author: Test User") && show.contains("+one"));
    }
}
