#!/usr/bin/env node
// PreToolUse hook on Bash: "kleine Commits" from CLAUDE.md, enforced. Blocks `git commit` when the change is too
// big to review in one sitting and tells Claude to split it.
//
// Why 400 lines: reviews find markedly fewer defects once a change goes past 200–400 lines (SmartBear/Cisco
// study of 2,500 reviews), and in this repo the last 60 squash merges have a median of 88 and a p90 of about
// 430 counted lines, so 400 only stops the outliers. Counted = added + deleted, without the files below.
//
// No dependencies, only node: built-ins, so it runs wherever Claude Code runs. Always exits 0: broken input or a
// missing git must never crash the hook or block unrelated Bash commands.

import { execFileSync } from "node:child_process";
import path from "node:path";

const LIMIT = 400;
const OVERRIDE_TRAILER = "Large-Commit:";

/** Files that are generated or pure data: nobody reviews them line by line, so they do not count. */
const IGNORED = [
  /(^|\/)pnpm-lock\.yaml$/, // lockfile
  /^drizzle\//, // generated migrations and snapshots
  /^evals\/.*\.json$/, // eval set and run results
  /^evals\/ergebnis[^/]*\.md$/, // written by `pnpm eval`
  /\.csv$/, // invented sample statements and fixtures
];

// Only at the start of a command (or after ; && || | and subshells), so `echo git commit` does not count.
const COMMIT = /(?:^|[;&|(])\s*git\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+|-c\s+\S+\s+|--[\w-]+(?:=\S+)?\s+)*commit\b/;

function workingDir(command, cwd) {
  const gitC = command.match(/git\s+-C\s+("([^"]*)"|'([^']*)'|(\S+))/);
  if (gitC) return path.resolve(cwd, gitC[2] ?? gitC[3] ?? gitC[4]);
  const cd = command.match(/^\s*cd\s+("([^"]*)"|'([^']*)'|(\S+))\s*&&/);
  if (cd) return path.resolve(cwd, cd[2] ?? cd[3] ?? cd[4]);
  return cwd;
}

/** `git commit -a` stages tracked changes itself, so the staged diff alone would undercount. */
function commitsAllTracked(command) {
  const afterCommit = command.slice(command.search(/\bcommit\b/));
  return /\s(--all\b|-[a-zA-Z]*a[a-zA-Z]*\b)/.test(afterCommit.split(/\s-m\s|\s--message[=\s]/)[0] ?? "");
}

function countChangedLines(dir, allTracked) {
  const args = allTracked ? ["diff", "HEAD", "--numstat"] : ["diff", "--cached", "--numstat"];
  const out = execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let total = 0;
  const counted = [];
  for (const line of out.split("\n")) {
    const [added, deleted, ...rest] = line.split("\t");
    const file = rest.join("\t");
    // Binary files report "-" and have no meaningful line count.
    if (!file || added === "-" || deleted === "-") continue;
    // Renames look like `dir/{old => new}.ts`; match against the new name.
    const name = file.replace(/\{[^}]* => ([^}]*)\}/, "$1").replace(/^.* => /, "");
    if (IGNORED.some((re) => re.test(name))) continue;
    const n = Number(added) + Number(deleted);
    total += n;
    counted.push({ file: name, n });
  }
  return { total, counted };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function respond(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
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
  if (input?.tool_name !== "Bash" || typeof command !== "string" || !COMMIT.test(command)) return;

  const dir = workingDir(command, input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd());
  let result;
  try {
    result = countChangedLines(dir, commitsAllTracked(command));
  } catch {
    // Not a repo or no HEAD yet: git itself will report the real problem.
    return;
  }
  if (result.total <= LIMIT) return;

  const biggest = result.counted
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map((f) => `  ${f.n}\t${f.file}`)
    .join("\n");
  const summary =
    `This commit changes ${result.total} lines (limit ${LIMIT}, lockfile/generated/eval data not counted).\n` +
    `Largest files:\n${biggest}`;

  if (command.includes(OVERRIDE_TRAILER)) {
    // A mechanical change (rename, move) can be large and still trivial to review. Claude may not wave it
    // through itself: the trailer only turns the block into a question that Ben answers.
    respond("ask", `${summary}\nThe message carries a ${OVERRIDE_TRAILER} reason. Ben decides.`);
    return;
  }
  respond(
    "deny",
    `${summary}\nSplit it into smaller commits, one step each: \`git restore --staged <file>\` or ` +
      "`git reset -p`, then commit the parts in order, each with `pnpm check` green. If it truly cannot be " +
      `split (e.g. a mechanical rename), ask Ben, then add a trailer \`${OVERRIDE_TRAILER} <why>\` to the ` +
      "message; he will be asked to confirm.",
  );
}

main().catch((error) => {
  process.stderr.write(`commit-size: ${error?.message ?? error}\n`);
});
