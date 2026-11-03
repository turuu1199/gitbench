import { parseDiff, buildPartialPatch, hunkLineIndices } from "../.test-build/lib/patch.js";
import { computeGraph } from "../.test-build/lib/graph.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const dir = mkdtempSync(join(tmpdir(), "gb-patch-"));
const git = (args, input) => execFileSync("git", ["-C", dir, ...args], { input, encoding: "utf8" });
git(["init", "-q", "-b", "main"]); git(["config", "user.name", "T"]); git(["config", "user.email", "t@e"]);
const orig = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
writeFileSync(join(dir, "f.txt"), orig); git(["add", "."]); git(["commit", "-qm", "init"]);
const lines = orig.trimEnd().split("\n");
lines[1] = "LINE 2"; lines.splice(2, 1); lines.splice(4, 0, "added A", "added B"); lines[24] = "LINE 25ish";
writeFileSync(join(dir, "f.txt"), lines.join("\n") + "\n");

const d = parseDiff(git(["diff", "--", "f.txt"]));
assert.equal(new Set(d.filter(l => l.kind === "hunk").map(l => l.hunk)).size, 2, "two hunks");
const find = (dd, text) => dd.findIndex(l => l.text === text);

let p = buildPartialPatch(d, new Set([find(d, "+added A")]), false);
git(["apply", "--cached", "--recount", "-"], p);
let staged = git(["diff", "--cached"]);
assert.match(staged, /^\+added A$/m); assert.doesNotMatch(staged, /added B|LINE 2|LINE 25/);
console.log("ok stage single added line");

const d2 = parseDiff(git(["diff", "--", "f.txt"]));
p = buildPartialPatch(d2, new Set([find(d2, "-line 3")]), false);
git(["apply", "--cached", "--recount", "-"], p);
staged = git(["diff", "--cached"]);
assert.match(staged, /^-line 3$/m); assert.doesNotMatch(staged, /LINE 2/);
console.log("ok stage single deleted line");

const ds = parseDiff(git(["diff", "--cached"]));
p = buildPartialPatch(ds, new Set([find(ds, "+added A")]), true);
git(["apply", "--cached", "--reverse", "--recount", "-"], p);
staged = git(["diff", "--cached"]);
assert.doesNotMatch(staged, /added A/); assert.match(staged, /^-line 3$/m);
console.log("ok unstage single line");

const d3 = parseDiff(git(["diff", "--", "f.txt"]));
const lastHunk = Math.max(...d3.map(l => l.hunk));
p = buildPartialPatch(d3, new Set(hunkLineIndices(d3, lastHunk)), true);
git(["apply", "--reverse", "--recount", "-"], p);
const wt = readFileSync(join(dir, "f.txt"), "utf8");
assert.match(wt, /^line 25$/m); assert.match(wt, /^LINE 2$/m); assert.match(wt, /^added B$/m);
console.log("ok reset hunk in worktree");
assert.equal(buildPartialPatch(d3, new Set(), false), null);

// No newline at end of file case.
writeFileSync(join(dir, "n.txt"), "a\nb"); git(["add", "n.txt"]); git(["commit", "-qm", "n"]);
writeFileSync(join(dir, "n.txt"), "A\nb\nc");
const dn = parseDiff(git(["diff", "--", "n.txt"]));
p = buildPartialPatch(dn, new Set([find(dn, "-a"), find(dn, "+A")]), false);
git(["apply", "--cached", "--recount", "-"], p);
assert.equal(git(["show", ":n.txt"]), "A\nb");
console.log("ok no-newline-at-eof partial stage");
rmSync(dir, { recursive: true, force: true });

const C = (hash, parents) => ({ hash, parents });
const rows = computeGraph([C("m", ["c", "f2"]), C("f2", ["f1"]), C("c", ["b"]), C("f1", ["b"]), C("b", ["a"]), C("a", [])]);
assert.equal(rows[0].lane, 0); assert.deepEqual(rows[0].before, [null]); assert.deepEqual(rows[0].after, ["c", "f2"]);
assert.equal(rows[1].lane, 1); assert.equal(rows[2].lane, 0);
assert.equal(rows[3].lane, 1); assert.deepEqual(rows[3].after, ["b", "b"]);
assert.equal(rows[4].lane, 0); assert.deepEqual(rows[4].before, ["b", "b"]); assert.deepEqual(rows[4].after, ["a"]);
assert.deepEqual(rows[5].after, []);
console.log("ok graph lanes");

// Extra ordering cases on a fresh repo.
{
  const dir2 = mkdtempSync(join(tmpdir(), "gb-patch2-"));
  const g = (args, input) => execFileSync("git", ["-C", dir2, ...args], { input, encoding: "utf8" });
  g(["init", "-q"]); g(["config", "user.name", "T"]); g(["config", "user.email", "t@e"]);
  const reset = (base, next) => { writeFileSync(join(dir2, "x"), base); g(["add", "."]); g(["commit", "-qm", "c", "--allow-empty"]); writeFileSync(join(dir2, "x"), next); };
  const stageSel = (texts) => { const dd = parseDiff(g(["diff", "--", "x"])); const p = buildPartialPatch(dd, new Set(texts.map(t => dd.findIndex(l => l.text === t))), false); g(["apply", "--cached", "--recount", "-"], p); return g(["show", ":x"]); };
  reset("a\nb\nc\nz\n", "X\nz\n");                     // -a -b -c +X
  assert.equal(stageSel(["-a", "-c", "+X"]), "X\nb\nz\n"); console.log("ok split block a,c->X");
  reset("1\n2\n3\n", "1\nTWO\nTHREE\n");               // -2 -3 +TWO +THREE
  assert.equal(stageSel(["-2", "+TWO"]), "1\nTWO\n3\n"); console.log("ok pairwise replace");
  // Reverse: reset the second replaced line in the worktree.
  reset("1\n2\n3\n", "1\nTWO\nTHREE\n");
  const dd = parseDiff(g(["diff", "--", "x"]));
  const p = buildPartialPatch(dd, new Set(["-3", "+THREE"].map(t => dd.findIndex(l => l.text === t))), true);
  g(["apply", "--reverse", "--recount", "-"], p);
  assert.equal(readFileSync(join(dir2, "x"), "utf8"), "1\nTWO\n3\n"); console.log("ok reverse reset pair");
  rmSync(dir2, { recursive: true, force: true });
}
