import { spawnSync } from "node:child_process";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "../..");

export type HookResult = { status: number | null; decision?: string; reason?: string; stderr: string };

/** Runs a hook exactly like Claude Code does: JSON on stdin, decision as JSON on stdout. */
export function runHook(name: string, stdin: string, env: Record<string, string> = {}): HookResult {
  const result = spawnSync(process.execPath, [path.join(REPO, ".claude/hooks", name)], {
    input: stdin,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO, ...env },
  });
  const out = result.stdout.trim();
  const parsed = out ? JSON.parse(out).hookSpecificOutput : undefined;
  return {
    status: result.status,
    decision: parsed?.permissionDecision,
    reason: parsed?.permissionDecisionReason,
    stderr: result.stderr,
  };
}
