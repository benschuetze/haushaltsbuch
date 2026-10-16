#!/usr/bin/env node
// PreToolUse hook on Bash: "kleine Commits" from CLAUDE.md, enforced. Blocks `git commit` when the change is too
// big to review in one sitting and tells Claude to split it; asks Ben when a commit touches the guardrails.
//
// Why 400 lines: reviews find markedly fewer defects once a change goes past 200–400 lines (SmartBear/Cisco
// study of 2,500 reviews), and in this repo the last 60 squash merges have a median of 88 and a p90 of about
// 430 counted lines, so 400 only stops the outliers. Counted = added + deleted, without the files below.
//
// The hook runs before the command, so it predicts each commit in it: what is staged now, plus what `git add`/`rm`/
// `mv` earlier in the same command, `-a`, `--amend` (measured against HEAD~1) and pathspecs will add, also inside
// `sh -c '...'`. shell.mjs does the parsing. For staging by pathspec the prediction counts more rather than less.
// Not covered: merge, cherry-pick, revert, rebase, am, stash, git aliases, `eval`, variables holding commands or
// paths, staging through `xargs` or `--pathspec-from-file`, commits from inside scripts. CI and review see those.
//
// No dependencies, only node: built-ins, so it runs wherever Claude Code runs. Always exits 0: broken input or a
// missing git must never crash the hook or block unrelated Bash commands.

import { execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { gitCommands, parseCommitArgs, parseStageArgs, writtenPaths } from "./shell.mjs";

const LIMIT = 400;
const OVERRIDE_TRAILER = "Large-Commit:";
const STAGING = new Set(["add", "stage", "rm", "mv"]);

/** Files that are generated or pure data: nobody reviews them line by line, so they do not count. */
const IGNORED = [
  /(^|\/)pnpm-lock\.yaml$/, // lockfile
  /^drizzle\//, // generated migrations and snapshots
  /^evals\/.*\.json$/, // eval set and run results
  /^evals\/ergebnis[^/]*\.md$/, // written by `pnpm eval`
  /\.csv$/, // invented sample statements and fixtures
];

/** Paths from "Nicht ohne Rückfrage ändern" and the guardrails themselves. Changed through Bash, they slip past
 * protect-paths.mjs; at commit time Ben is asked. Matched in lower case. */
const GUARDED = [
  /^\.github\/workflows\//,
  /^\.github\/codeowners$/,
  /^\.claude\/hooks\//,
  /^\.claude\/settings(\.local)?\.json$/,
  /^beispieldaten\/erwartet\.json$/,
];
const isGuarded = (rel) => GUARDED.some((re) => re.test(rel.toLowerCase()));
/** Guarded paths as plain prefixes, to tell whether a folder holds one: `rm -rf .claude` removes the guardrails. */
const GUARDED_PREFIXES = [
  ".claude/hooks/",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".github/workflows/",
  ".github/codeowners",
  "beispieldaten/erwartet.json",
];
const holdsGuarded = (rel) => rel === "" || GUARDED_PREFIXES.some((p) => p.startsWith(`${rel}/`));

const toRel = (root, absolute) => path.relative(root, absolute).split(path.sep).join("/");

function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The real path of `p`, or of its longest existing ancestor with the rest appended (for files not written yet). */
function resolveExisting(p) {
  let head = p;
  const tail = [];
  for (;;) {
    try {
      return path.join(realpathSync(head), ...tail);
    } catch {
      const parent = path.dirname(head);
      if (parent === head) return p;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function emptyTree(root) {
  return execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], {
    cwd: root,
    input: "",
    encoding: "utf8",
  }).trim();
}

/** What the commit is compared against: HEAD, its parent for --amend, or the empty tree for a first commit. */
function baseFor(root, amend) {
  const ref = amend ? "HEAD~1" : "HEAD";
  try {
    git(root, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
    return ref;
  } catch {
    return emptyTree(root);
  }
}

/** `git diff --numstat` without rename detection, so a moved file shows both its old and its new path. */
function numstat(root, args, into) {
  const out = git(root, ["diff", "--numstat", "-z", "--no-renames", ...args]);
  for (const record of out.split("\0")) {
    const [added, deleted, ...rest] = record.split("\t");
    const file = rest.join("\t");
    if (!file) continue;
    // Binary files report "-" and have no meaningful line count.
    const n = added === "-" || deleted === "-" ? 0 : Number(added) + Number(deleted);
    into.set(file, Math.max(into.get(file) ?? 0, n));
  }
}

/** Line count of a file on disk, read in chunks so size does not matter. Binary files (a NUL byte) count 0. */
function countLines(full) {
  const fd = openSync(full, "r");
  try {
    const buf = Buffer.alloc(1 << 20);
    let lines = 0;
    let last = 0x0a;
    let first = true;
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const chunk = buf.subarray(0, n);
      if (first && chunk.subarray(0, 8000).includes(0)) return 0;
      first = false;
      for (const byte of chunk) if (byte === 0x0a) lines++;
      last = chunk[n - 1];
    }
    return last === 0x0a ? lines : lines + 1;
  } finally {
    closeSync(fd);
  }
}

/** Untracked files that `git add` would pick up. `force` (`git add -f`) includes ignored files. */
function untracked(root, pathspecs, into, force) {
  const args = ["ls-files", "--others", "--full-name", "-z"];
  if (!force) args.push("--exclude-standard");
  for (const file of git(root, [...args, "--", ...pathspecs]).split("\0")) {
    if (!file) continue;
    let n = 0;
    try {
      const full = path.join(root, file);
      if (statSync(full).isFile()) n = countLines(full);
    } catch {
      // Unreadable: count as 0 rather than fail.
    }
    into.set(file, Math.max(into.get(file) ?? 0, n));
  }
}

/** Files that `git rm`/`git mv` will take out of the index, with their committed size (not yet visible on disk). */
function removedFromBase(root, base, specs, into) {
  const empty = emptyTree(root);
  if (specs.length === 0 || base === empty) return;
  numstat(root, [empty, base, "--", ...specs], into);
}

function isDirectory(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

const absolute = (dir, specs) => specs.map((s) => (s.startsWith(":") ? s : path.resolve(dir, s)));

/** Predicts the files of one commit. `indexCounts` is false after an earlier commit in the same line emptied it. */
function predict(root, commit, staging, indexCounts) {
  const opts = parseCommitArgs(commit.args);
  const base = baseFor(root, opts.amend);
  const files = new Map();
  if (indexCounts) numstat(root, ["--cached", base], files);
  else if (opts.amend) numstat(root, [base, "HEAD"], files);
  if (opts.all) numstat(root, [base], files);
  if (opts.pathspecs.length > 0) numstat(root, [base, "--", ...absolute(commit.dir, opts.pathspecs)], files);

  for (const stage of staging) {
    const s = parseStageArgs(stage.args);
    const specs = absolute(stage.dir, s.pathspecs);
    if (stage.sub === "rm" || stage.sub === "mv") {
      // `git mv a b` or `git mv a b dir/`: the sources leave, the destination arrives with the same content.
      const sources = stage.sub === "mv" ? specs.slice(0, -1) : specs;
      removedFromBase(root, base, sources, files);
      if (stage.sub === "mv") {
        const dest = specs.at(-1) ?? root;
        const intoDir = sources.length > 1 || isDirectory(dest);
        for (const source of sources) {
          const moved = new Map();
          removedFromBase(root, base, [source], moved);
          const target = intoDir ? path.join(dest, path.basename(source)) : dest;
          for (const [file, n] of moved) {
            const name = toRel(root, path.join(target, path.relative(source, path.join(root, file))));
            files.set(name, Math.max(files.get(name) ?? 0, n));
          }
        }
      }
      continue;
    }
    if (s.everything || (s.trackedOnly && s.pathspecs.length === 0)) numstat(root, [base], files);
    if (specs.length > 0) numstat(root, [base, "--", ...specs], files);
    if (s.everything && s.pathspecs.length === 0) untracked(root, [], files, s.force);
    else if (!s.trackedOnly && specs.length > 0) untracked(root, specs, files, s.force);
  }
  return files;
}

/**
 * Guarded paths, or folders holding one (the repo root included), that commands before the commit write: known
 * writers (`rm`, `mv`, `cp`, `sed -i`, `tee`, `git rm`/`checkout` …) and output redirections, following `cd`. Their
 * effect is invisible before the command runs. `unknown` names a command or path whose writes could not be determined.
 */
function guardedWrites(line, cwd, root) {
  const { paths, unknown } = writtenPaths(line, cwd);
  const hits = new Set();
  for (const absolute of paths) {
    const rel = toRel(root, resolveExisting(absolute));
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue;
    const lower = rel.toLowerCase();
    if (isGuarded(lower) || holdsGuarded(lower)) hits.add(rel || ".");
  }
  return { hits: [...hits], unknown };
}

function check(command, cwd) {
  let verdict = null;
  let staging = [];
  let commitsSeen = 0;
  for (const cmd of gitCommands(command, cwd)) {
    if (STAGING.has(cmd.sub)) {
      staging.push(cmd);
      continue;
    }
    if (cmd.sub !== "commit") continue;
    if (cmd.dir === null) {
      verdict = {
        decision: "ask",
        reason:
          "This commit runs in a directory taken from a variable or substitution, so its size and content could " +
          "not be checked. Ben decides.",
      };
      continue;
    }
    // Resolved first, so git runs in the repo that is judged, not in one a symlink points into.
    cmd.dir = resolveExisting(cmd.dir);
    const root = findRepoRoot(cmd.dir);
    if (!root) continue;
    let files;
    try {
      files = predict(
        root,
        cmd,
        staging.filter((s) => s.dir !== null && findRepoRoot(resolveExisting(s.dir)) === root),
        commitsSeen === 0,
      );
    } catch {
      // Not a repo, no HEAD, or git missing: git itself will report the real problem.
      continue;
    }
    // The next commit in this line starts from what this one leaves behind.
    staging = [];
    commitsSeen++;

    const entries = [...files].map(([file, n]) => ({ file, n }));
    const counted = entries.filter((e) => !IGNORED.some((re) => re.test(e.file)));
    const total = counted.reduce((sum, e) => sum + e.n, 0);
    const written = guardedWrites(command, cwd, root);
    const guarded = [...new Set([...entries.map((e) => e.file).filter(isGuarded), ...written.hits])];

    if (total > LIMIT && !command.includes(OVERRIDE_TRAILER)) {
      const biggest = counted
        .sort((a, b) => b.n - a.n)
        .slice(0, 5)
        .map((e) => `  ${e.n}\t${e.file}`)
        .join("\n");
      return {
        decision: "deny",
        reason:
          `This commit changes ${total} lines (limit ${LIMIT}, lockfile/generated/eval data not counted).\n` +
          `Largest files:\n${biggest}\n` +
          "Split it into smaller commits, one step each: `git restore --staged <file>` or `git reset -p`, then " +
          "commit the parts in order, each with `pnpm check` green. If it truly cannot be split (e.g. a mechanical " +
          `rename), ask Ben, then add a trailer \`${OVERRIDE_TRAILER} <why>\` to the message; he will be asked to confirm.`,
      };
    }
    const questions = [];
    // A mechanical change (rename, move) can be large and still trivial to review. Claude may not wave it
    // through itself: the trailer only turns the block into a question that Ben answers.
    if (total > LIMIT)
      questions.push(`This commit changes ${total} lines (limit ${LIMIT}) and carries a ${OVERRIDE_TRAILER} reason.`);
    if (guarded.length > 0) {
      questions.push(
        `It changes ${guarded.join(", ")}, or a command before it writes there: listed under "Nicht ohne ` +
          'Rückfrage ändern" or part of the guardrails. A change made through Bash was not shown to Ben when it was written.',
      );
    }
    if (written.unknown) {
      questions.push(
        `\`${written.unknown}\` before the commit may change files it does not name, so the commit could not be ` +
          "predicted. Run it in its own call, then commit.",
      );
    }
    if (questions.length > 0) verdict = { decision: "ask", reason: `${questions.join("\n")}\nBen decides.` };
  }
  return verdict;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    process.stderr.write("commit-size: could not parse hook input, skipping\n");
    return;
  }
  const command = input?.tool_input?.command;
  if (input?.tool_name !== "Bash" || typeof command !== "string" || !command.includes("commit")) return;
  const result = check(command, input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!result) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason,
      },
    }),
  );
}

main().catch((error) => {
  process.stderr.write(`commit-size: ${error?.message ?? error}\n`);
});
