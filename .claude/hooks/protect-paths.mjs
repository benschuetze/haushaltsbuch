#!/usr/bin/env node
// PreToolUse hook: turns "Nicht ohne Rückfrage ändern" from CLAUDE.md into a rule the harness enforces.
// No dependencies and only node: built-ins, so it runs on macOS, Linux and Windows without an install step.
//
// Protocol: Claude Code sends the tool call as JSON on stdin. We answer with a permission decision on stdout
// and always exit 0: a hook that crashes must not turn into a silent allow or a confusing error.

import { existsSync } from "node:fs";
import path from "node:path";

const FILE_TOOLS = new Set(["Read", "Edit", "Write", "MultiEdit", "NotebookEdit"]);
const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * Rules are matched against the repo-relative path in lower case, because macOS and Windows file systems are
 * case-insensitive and `Drizzle/x.sql` would otherwise slip through.
 * `deny` = never by hand, there is a proper way that does not go through Edit/Write.
 * `ask` = allowed after Ben says yes; the harness shows him the change and waits for his click.
 */
const RULES = [
  {
    test: (p) => isEnvFile(p),
    tools: FILE_TOOLS,
    decision: "deny",
    reason:
      "Secrets live in .env files and must not enter the conversation or be rewritten. " +
      "Ask Ben for the variable name you need and document it in .env.example instead.",
  },
  {
    test: (p) => p.startsWith("drizzle/"),
    tools: WRITE_TOOLS,
    decision: "deny",
    reason:
      "drizzle/ is generated. Change app/lib/db/schema.ts and run `pnpm db:generate` following the skill " +
      "db-change; never edit migrations by hand.",
  },
  {
    test: (p) => p.startsWith(".github/workflows/"),
    tools: WRITE_TOOLS,
    decision: "ask",
    reason:
      ".github/workflows/ is listed under 'Nicht ohne Rückfrage ändern' (actions pinned to commit SHAs, minimal " +
      "permissions). Show Ben the diff in chat and only proceed once he has said yes.",
  },
  {
    test: (p) => p === "beispieldaten/erwartet.json",
    tools: WRITE_TOOLS,
    decision: "ask",
    reason:
      "beispieldaten/erwartet.json is recalculated by hand. If a test fails against it, the code is the first " +
      "suspect. Only change it after explaining the recalculation to Ben and getting his yes.",
  },
  {
    // Without this, the guardrail could be switched off by editing the file that defines it.
    test: (p) => p === ".claude/settings.json" || p.startsWith(".claude/hooks/"),
    tools: WRITE_TOOLS,
    decision: "ask",
    reason: "This file enforces the project's guardrails. Changing it needs Ben's explicit yes.",
  },
];

function isEnvFile(p) {
  const base = p.split("/").pop() ?? "";
  return (base === ".env" || base.startsWith(".env.")) && base !== ".env.example";
}

/** Repo root for a file: the nearest ancestor with a `.git` entry (a directory, or a file in a worktree). */
function findRepoRoot(start) {
  let dir = start;
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function relativeToRepo(filePath, projectDir) {
  const absolute = path.resolve(projectDir, filePath);
  let rel = path.relative(projectDir, absolute);
  // A file in a sibling worktree is still this repo; resolve against its own root.
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    const root = findRepoRoot(path.dirname(absolute));
    if (root) rel = path.relative(root, absolute);
  }
  return rel.split(path.sep).join("/").toLowerCase();
}

/** @returns {{decision: "deny" | "ask", reason: string} | null} */
function decide(input, projectDir) {
  const tool = input?.tool_name;
  if (typeof tool !== "string" || !FILE_TOOLS.has(tool)) return null;
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
  if (typeof target !== "string" || target === "") return null;
  const rel = relativeToRepo(target, projectDir);
  for (const rule of RULES) {
    if (rule.tools.has(tool) && rule.test(rel)) return { decision: rule.decision, reason: `${rel}: ${rule.reason}` };
  }
  return null;
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
    // Unreadable input: stay out of the way. permissions.deny in settings.json still covers the hard cases.
    process.stderr.write("protect-paths: could not parse hook input, skipping\n");
    return;
  }
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  const result = decide(input, projectDir);
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
  process.stderr.write(`protect-paths: ${error?.message ?? error}\n`);
});
