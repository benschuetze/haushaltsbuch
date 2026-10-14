import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHook } from "./run-hook";

let repo: string;
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
function stage(file: string, n: number) {
  mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  writeFileSync(path.join(repo, file), lines(n));
  git("add", file);
}
const commit = (command: string, cwd = repo) =>
  runHook("commit-size.mjs", JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd }));

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "commit-size-"));
  git("init", "-q");
  git("-c", "user.email=t@example.test", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("commit-size hook", () => {
  it("allows a commit up to 400 changed lines", () => {
    stage("app/a.ts", 400);
    expect(commit('git commit -m "feat: a"')).toMatchObject({ status: 0, decision: undefined });
  });

  it("blocks a bigger commit, names the largest files and says how to split", () => {
    stage("app/a.ts", 300);
    stage("app/b.ts", 150);
    const result = commit('git commit -m "feat: too much"');
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("450 lines");
    expect(result.reason).toContain("app/a.ts");
    expect(result.reason).toMatch(/git reset -p/);
  });

  it("does not count lockfile, generated migrations, eval data or sample CSVs", () => {
    stage("app/a.ts", 100);
    stage("pnpm-lock.yaml", 5000);
    stage("drizzle/0001_x.sql", 900);
    stage("evals/kategorisierung.json", 900);
    stage("evals/ergebnis.md", 900);
    stage("beispieldaten/demo.csv", 900);
    expect(commit("git commit -m x").decision).toBeUndefined();
  });

  it("counts tracked changes that `git commit -a` would add", () => {
    stage("app/a.ts", 10);
    git("-c", "user.email=t@example.test", "-c", "user.name=t", "commit", "-q", "-m", "a");
    writeFileSync(path.join(repo, "app/a.ts"), lines(500).replaceAll("line", "row"));
    expect(commit("git commit -m x").decision).toBeUndefined();
    expect(commit('git commit -am "x"').decision).toBe("deny");
  });

  it("finds the repo behind `cd dir &&` and `git -C dir`", () => {
    stage("app/a.ts", 500);
    expect(commit(`cd ${repo} && git commit -m x`, tmpdir()).decision).toBe("deny");
    expect(commit(`git -C "${repo}" commit -m x`, tmpdir()).decision).toBe("deny");
  });

  it("turns the block into a question for Ben when the message gives a Large-Commit reason", () => {
    stage("app/a.ts", 500);
    expect(commit('git commit -m "refactor: rename" -m "Large-Commit: mechanical rename"').decision).toBe("ask");
  });

  it("leaves other Bash commands alone", () => {
    stage("app/a.ts", 500);
    for (const command of ["git status", "git log --grep commit", "echo git commit later", "pnpm check"]) {
      expect(commit(command).decision, command).toBeUndefined();
    }
  });

  it("does not throw on broken input or outside a repo", () => {
    for (const stdin of ["", "not json", "null", "{}", '{"tool_name":"Bash","tool_input":{"command":7}}']) {
      const result = runHook("commit-size.mjs", stdin);
      expect(result.status, stdin).toBe(0);
      expect(result.decision, stdin).toBeUndefined();
    }
    const outside = mkdtempSync(path.join(tmpdir(), "no-repo-"));
    expect(commit("git commit -m x", outside)).toMatchObject({ status: 0, decision: undefined });
    rmSync(outside, { recursive: true, force: true });
  });
});
