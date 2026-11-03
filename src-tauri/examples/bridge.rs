//! Dev-only HTTP bridge to the git backend, for testing the UI in a normal
//! browser (e.g. automated UI tests) without the Tauri webview.
//!
//!   cargo run --example bridge            # listens on 127.0.0.1:1421
//!
//! Only requests from the Vite dev server origin are accepted. Never ship this.

use gitbench_lib::git::{self, LogOptions};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

const ORIGIN: &str = "http://localhost:1420";

fn s(a: &Value, k: &str) -> String {
    a.get(k).and_then(Value::as_str).unwrap_or_default().to_string()
}
fn opt(a: &Value, k: &str) -> Option<String> {
    a.get(k).and_then(Value::as_str).map(String::from)
}
fn strs(a: &Value, k: &str) -> Vec<String> {
    a.get(k)
        .and_then(Value::as_array)
        .map(|v| v.iter().filter_map(|x| x.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

fn to<T: serde::Serialize>(v: Result<T, String>) -> Result<Value, String> {
    v.map(|x| serde_json::to_value(x).unwrap())
}

fn dispatch(cmd: &str, a: &Value) -> Result<Value, String> {
    let repo = s(a, "repo");
    match cmd {
        "git" => {
            let args = strs(a, "args");
            to(git::run_combined(&repo, &args.iter().map(String::as_str).collect::<Vec<_>>()))
        }
        "git_stdin" => {
            let args = strs(a, "args");
            to(git::run_stdin(&repo, &args.iter().map(String::as_str).collect::<Vec<_>>(), &s(a, "input")))
        }
        "open_repo" => to(git::open_repo(&s(a, "path"))),
        "init_repo" => to(git::init_repo(&s(a, "path"), a["bare"].as_bool().unwrap_or(false))),
        "clone_repo" => to(git::clone_repo(&s(a, "url"), &s(a, "dest"))),
        "log" => {
            let path = opt(a, "path");
            let rev = opt(a, "rev");
            to(git::log(
                &repo,
                LogOptions {
                    limit: a["limit"].as_u64().unwrap_or(2000) as u32,
                    all: a["all"].as_bool().unwrap_or(true),
                    path: path.as_deref(),
                    rev: rev.as_deref(),
                },
            ))
        }
        "commit_info" => to(git::commit_info(&repo, &s(a, "hash"))),
        "branches" => to(git::branches(&repo)),
        "tags" => to(git::tags(&repo)),
        "remotes" => to(git::remotes(&repo)),
        "stashes" => to(git::stashes(&repo)),
        "submodules" => to(git::submodules(&repo)),
        "status" => to(git::status(&repo)),
        "commit_files" => to(git::commit_files(&repo, &s(a, "hash"), opt(a, "base").as_deref())),
        "diff_commit_file" => to(git::diff_commit_file(
            &repo,
            &s(a, "hash"),
            opt(a, "base").as_deref(),
            &s(a, "path"),
            opt(a, "origPath").as_deref(),
        )),
        "diff_file" => to(git::diff_file(&repo, &s(a, "path"), a["staged"].as_bool().unwrap_or(false), a["untracked"].as_bool().unwrap_or(false))),
        "show_commit" => to(git::show_commit(&repo, &s(a, "hash"))),
        "ls_tree" => to(git::ls_tree(&repo, &s(a, "hash"))),
        "file_at" => to(git::file_at(&repo, &s(a, "hash"), &s(a, "path"))),
        "blame" => to(git::blame(&repo, opt(a, "hash").as_deref(), &s(a, "path"))),
        "append_gitignore" => to(git::append_gitignore(&repo, &s(a, "pattern"))),
        _ => Err(format!("unknown command {cmd}")),
    }
}

fn main() {
    let listener = TcpListener::bind("127.0.0.1:1421").expect("bind 127.0.0.1:1421");
    eprintln!("bridge listening on http://127.0.0.1:1421 (origin {ORIGIN} only)");
    for stream in listener.incoming().flatten() {
        std::thread::spawn(move || {
            let mut reader = BufReader::new(&stream);
            let mut line = String::new();
            if reader.read_line(&mut line).is_err() {
                return;
            }
            let method = line.split_whitespace().next().unwrap_or("").to_string();
            let (mut len, mut origin) = (0usize, String::new());
            loop {
                let mut h = String::new();
                if reader.read_line(&mut h).is_err() || h.trim().is_empty() {
                    break;
                }
                let lower = h.to_ascii_lowercase();
                if let Some(v) = lower.strip_prefix("content-length:") {
                    len = v.trim().parse().unwrap_or(0);
                }
                if lower.starts_with("origin:") {
                    origin = h[7..].trim().to_string();
                }
            }
            let mut body = vec![0; len];
            let _ = reader.read_exact(&mut body);
            let (status, payload) = if origin != ORIGIN {
                ("403 Forbidden", json!({"error": "origin not allowed"}))
            } else if method == "OPTIONS" {
                ("204 No Content", Value::Null)
            } else {
                let req: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
                match dispatch(req["cmd"].as_str().unwrap_or(""), &req["args"]) {
                    Ok(v) => ("200 OK", json!({ "ok": v })),
                    Err(e) => ("200 OK", json!({ "error": e })),
                }
            };
            let text = if payload.is_null() { String::new() } else { payload.to_string() };
            let resp = format!(
                "HTTP/1.1 {status}\r\nAccess-Control-Allow-Origin: {ORIGIN}\r\nAccess-Control-Allow-Headers: content-type\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{text}",
                text.len()
            );
            let _ = (&stream).write_all(resp.as_bytes());
        });
    }
}
