import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, FolderOpen, RefreshCw, X } from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, FileChange, isConflict, ops } from "../api";
import { buildResult, Choice, ConflictSeg, hasMarkers, parseConflicts, resolveSeg, Segment } from "../lib/conflict";
import { basename, errorText } from "../lib/format";
import { useRepo } from "../repo";
import { confirm } from "./ui/Dialogs";
import { Splitter, useSplit } from "./ui/Splitter";

interface Props {
  onClose: () => void;
}

/** Human description of a porcelain XY conflict code. */
function conflictKind(f: FileChange) {
  const k = f.index + f.worktree;
  return (
    {
      UU: "both modified",
      AA: "both added",
      DD: "both deleted",
      UD: "deleted by them",
      DU: "deleted by us",
      AU: "added by us",
      UA: "added by them",
    } as Record<string, string>
  )[k] ?? k;
}

const CHOICES: { c: Choice; label: string; title: string }[] = [
  { c: "ours", label: "Ours", title: "Keep the current-branch version" },
  { c: "theirs", label: "Theirs", title: "Keep the incoming version" },
  { c: "ours-theirs", label: "Ours + Theirs", title: "Keep both, ours first" },
  { c: "theirs-ours", label: "Theirs + Ours", title: "Keep both, theirs first" },
];

export function ConflictResolver({ onClose }: Props) {
  const { data, actions } = useRepo();
  const root = data.info.root;
  const state = data.info.state;
  const [files, setFiles] = useState<FileChange[]>(data.status.filter(isConflict));
  const [path, setPath] = useState<string | null>(files[0]?.path ?? null);
  const [segs, setSegs] = useState<Segment[]>([]);
  const [choices, setChoices] = useState<(Choice | undefined)[]>([]);
  const [loadError, setLoadError] = useState("");
  const [manual, setManual] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mergeTool, setMergeTool] = useState("");
  const [leftW, onSplitX] = useSplit("conflicts.left", 280, "x", 180);

  const file = files.find((f) => f.path === path) ?? null;
  const conflicts = useMemo(() => segs.filter((s): s is ConflictSeg => s.kind === "conflict"), [segs]);
  const unresolved = conflicts.length - choices.filter(Boolean).length;
  const result = useMemo(() => manual ?? buildResult(segs, choices), [manual, segs, choices]);

  const reloadList = useCallback(async () => {
    const s = (await api.status(root)).filter(isConflict);
    setFiles(s);
    return s;
  }, [root]);

  const loadFile = useCallback(
    async (p: string | null) => {
      setSegs([]);
      setChoices([]);
      setManual(null);
      setLoadError("");
      setError("");
      if (!p) return;
      try {
        const text = await api.readWorktreeFile(root, p);
        const s = parseConflicts(text);
        setSegs(s);
        if (!s.some((x) => x.kind === "conflict")) setLoadError("No conflict markers left in this file. Mark it as resolved, or pick a whole-file version.");
      } catch (e) {
        setLoadError(`${errorText(e)} — choose a whole-file version below.`);
      }
    },
    [root],
  );

  useEffect(() => {
    loadFile(path);
  }, [path, loadFile]);

  useEffect(() => {
    reloadList();
    ops.getConfig(root, "merge.tool").then(setMergeTool);
  }, [root, reloadList]);

  /** Run a git step for the current file, then move on to the next conflict. */
  const finish = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      const left = await reloadList();
      actions.refresh();
      // Stay on the file if it is still conflicted, else move to the next one.
      if (left.some((f) => f.path === path)) loadFile(path);
      else setPath(left[0]?.path ?? null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!path) return;
    if (hasMarkers(result) && !(await confirm("Conflict markers left", "The result still contains conflict markers. Save and mark the file as resolved anyway?", "Save anyway", true)))
      return;
    finish(async () => {
      await api.writeWorktreeFile(root, path, result);
      await ops.stage(root, [path]);
    });
  };

  const wholeFile = (side: "ours" | "theirs") => {
    if (!file) return;
    const deleted = side === "ours" ? file.index === "D" : file.worktree === "D";
    finish(async () => {
      if (deleted || (file.index === "D" && file.worktree === "D")) await api.git(root, ["rm", "-q", "--", file.path]);
      else {
        await api.git(root, ["checkout", `--${side}`, "--", file.path]);
        await ops.stage(root, [file.path]);
      }
    });
  };

  const runMergeTool = () => {
    if (!path) return;
    finish(() => api.git(root, ["mergetool", "--no-prompt", "--", path]));
  };

  const choose = (i: number, c: Choice | undefined) => {
    setChoices((prev) => {
      const next = [...prev];
      next[i] = c;
      return next;
    });
  };
  const chooseAll = (c: Choice) => setChoices(conflicts.map(() => c));

  const scrollTo = (dir: 1 | -1) => {
    const els = [...document.querySelectorAll<HTMLElement>(".cr-block.open")];
    if (!els.length) return;
    const top = document.querySelector(".cr-body")!.getBoundingClientRect().top + 8;
    const target = dir > 0 ? els.find((e) => e.getBoundingClientRect().top > top + 4) ?? els[0] : [...els].reverse().find((e) => e.getBoundingClientRect().top < top - 4) ?? els[els.length - 1];
    target.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector(".dialog")) onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);

  const oursDeleted = file?.index === "D";
  const theirsDeleted = file?.worktree === "D";
  let n = -1;

  return (
    <div className="modal-backdrop">
      <div className="window">
        <header className="window-title">
          <span>
            Resolve conflicts — <b>{state || "no operation in progress"}</b> in {basename(root)}
          </span>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <X size={16} />
          </button>
        </header>
        <div className="commit-main">
          <div className="commit-left" style={{ width: leftW }}>
            <div className="list-head">
              <span>Conflicted files ({files.length})</span>
              <button className="icon-btn" title="Refresh" onClick={() => reloadList().then(() => loadFile(path))}>
                <RefreshCw size={14} />
              </button>
            </div>
            <ul className="file-list" tabIndex={0}>
              {files.map((f) => (
                <li key={f.path} className={f.path === path ? "active" : ""} onMouseDown={() => setPath(f.path)} title={f.path}>
                  <span className="fname">{basename(f.path)}</span>
                  <span className="fdir">{conflictKind(f)}</span>
                </li>
              ))}
            </ul>
            {!files.length && (
              <div className="cr-done">
                <p>All conflicts resolved.</p>
                {state && (
                  <button
                    className="primary"
                    onClick={() => {
                      onClose();
                      actions.sequencer("continue");
                    }}
                  >
                    Continue {state}
                  </button>
                )}
              </div>
            )}
          </div>
          <Splitter dir="x" onMouseDown={onSplitX} />
          <div className="commit-right">
            {file ? (
              <>
                <div className="viewer-bar">
                  <span className="viewer-path">
                    {file.path} <span className="muted">({conflictKind(file)})</span>
                  </span>
                  <button disabled={busy} onClick={() => wholeFile("ours")} title="Take the whole file from the current branch">
                    {oursDeleted ? "Delete (ours)" : "Use ours file"}
                  </button>
                  <button disabled={busy} onClick={() => wholeFile("theirs")} title="Take the whole file from the incoming side">
                    {theirsDeleted ? "Delete (theirs)" : "Use theirs file"}
                  </button>
                  <button
                    disabled={busy || !mergeTool}
                    onClick={runMergeTool}
                    title={mergeTool ? `git mergetool (${mergeTool})` : "Set merge.tool first, e.g. git config --global merge.tool meld"}
                  >
                    Merge tool{mergeTool ? ` (${mergeTool})` : ""}
                  </button>
                  <button className="icon-btn" title="Show in folder" onClick={() => revealItemInDir(`${root}/${file.path}`)}>
                    <FolderOpen size={14} />
                  </button>
                </div>
                {conflicts.length > 0 && (
                  <div className="viewer-bar cr-toolbar">
                    <span className="small">
                      {conflicts.length} conflict{conflicts.length > 1 ? "s" : ""}, <b>{manual !== null ? "manual edit" : `${unresolved} unresolved`}</b>
                    </span>
                    <button className="icon-btn" title="Previous conflict" onClick={() => scrollTo(-1)}>
                      <ChevronUp size={14} />
                    </button>
                    <button className="icon-btn" title="Next conflict" onClick={() => scrollTo(1)}>
                      <ChevronDown size={14} />
                    </button>
                    <span className="tb-sep" />
                    <button disabled={manual !== null} onClick={() => chooseAll("ours")}>All ours</button>
                    <button disabled={manual !== null} onClick={() => chooseAll("theirs")}>All theirs</button>
                    <span style={{ flex: 1 }} />
                    <label className="check">
                      <input type="checkbox" checked={manual !== null} onChange={(e) => setManual(e.target.checked ? buildResult(segs, choices) : null)} /> Edit result by hand
                    </label>
                  </div>
                )}
                <div className="viewer-body cr-body">
                  {loadError && <div className="empty">{loadError}</div>}
                  {manual !== null ? (
                    <textarea className="cr-manual" spellCheck={false} value={manual} onChange={(e) => setManual(e.target.value)} />
                  ) : (
                    segs.map((s, si) => {
                      if (s.kind === "text") return <TextBlock key={si} text={s.text} />;
                      const i = ++n;
                      const ch = choices[i];
                      return (
                        <div key={si} className={`cr-block ${ch ? "done" : "open"}`}>
                          <div className="cr-actions">
                            <b>Conflict {i + 1}</b>
                            {CHOICES.map((o) => (
                              <button key={o.c} className={ch === o.c ? "primary" : ""} title={o.title} onClick={() => choose(i, o.c)}>
                                {o.label}
                              </button>
                            ))}
                            {s.base !== null && (
                              <button className={ch === "base" ? "primary" : ""} title="Keep the common-ancestor version" onClick={() => choose(i, "base")}>
                                Base
                              </button>
                            )}
                            <button className={ch === "none" ? "primary" : ""} title="Drop both sides" onClick={() => choose(i, "none")}>
                              Neither
                            </button>
                            {ch && <button onClick={() => choose(i, undefined)}>Undo</button>}
                          </div>
                          {ch ? (
                            <pre className="cr-code cr-result">{resolveSeg(s, ch) || "(empty)"}</pre>
                          ) : (
                            <div className="cr-sides">
                              <div>
                                <div className="cr-label ours">Ours — {s.oursLabel || "current"}</div>
                                <pre className="cr-code ours">{s.ours || "(empty)"}</pre>
                              </div>
                              {s.base !== null && (
                                <div>
                                  <div className="cr-label">Base — {s.baseLabel || "ancestor"}</div>
                                  <pre className="cr-code">{s.base || "(empty)"}</pre>
                                </div>
                              )}
                              <div>
                                <div className="cr-label theirs">Theirs — {s.theirsLabel || "incoming"}</div>
                                <pre className="cr-code theirs">{s.theirs || "(empty)"}</pre>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="window-status cr-footer">
                  {error ? <span className="danger-text">{error}</span> : <span className="muted">Save writes the result and stages the file (git add).</span>}
                  <span style={{ flex: 1 }} />
                  <button disabled={busy} onClick={() => finish(() => ops.stage(root, [file.path]))} title="Stage the file as it is on disk">
                    Mark resolved
                  </button>
                  <button className="primary" disabled={busy || !segs.length} onClick={save}>
                    Save &amp; mark resolved
                  </button>
                </div>
              </>
            ) : (
              <div className="empty">{files.length ? "Select a file" : "No conflicted files."}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Unchanged text between conflicts; long runs are collapsed. */
function TextBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ls = text.split("\n");
  if (ls[ls.length - 1] === "") ls.pop();
  const ctx = 3;
  if (open || ls.length <= ctx * 2 + 2) return <pre className="cr-code cr-ctx">{ls.join("\n")}</pre>;
  return (
    <>
      <pre className="cr-code cr-ctx">{ls.slice(0, ctx).join("\n")}</pre>
      <button className="cr-fold" onClick={() => setOpen(true)}>
        ⋯ {ls.length - ctx * 2} unchanged lines
      </button>
      <pre className="cr-code cr-ctx">{ls.slice(-ctx).join("\n")}</pre>
    </>
  );
}
