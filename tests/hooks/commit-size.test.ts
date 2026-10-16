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

  // The hook runs before the command, so it has to predict what each `git commit` in it will contain.
  describe("predicts the commit from the whole command", () => {
    const save = (message: string) =>
      git("-c", "user.email=t@example.test", "-c", "user.name=t", "commit", "-q", "-m", message);
    const write = (file: string, n: number, word = "line") => {
      mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      writeFileSync(path.join(repo, file), lines(n).replaceAll("line", word));
    };
    const tracked = () => {
      stage("app/a.ts", 10);
      save("a");
      write("app/a.ts", 600, "row");
    };

    it("sees what `git add` earlier in the same command stages, new files included", () => {
      write("app/new.ts", 600);
      expect(commit("git add -A && git commit -m x").decision).toBe("deny");
      expect(commit("git add . && git commit -m x").decision).toBe("deny");
      expect(commit("git add other.ts && git commit -m x").decision).toBeUndefined();
    });

    it("recognises -a and the commit in every common spelling", () => {
      tracked();
      for (const command of [
        'git commit -m "x" -a',
        "git commit --message=x --all",
        'git -c user.name="a b" commit -am x',
        "git -p commit -am x",
        "GIT_AUTHOR_NAME=x git commit -am x",
        "{ git commit -am x; }",
        "echo hi\ngit commit -am x",
        'sh -c "git commit -am x"',
        "sudo -u me git commit -am x",
        "git commit app/a.ts -m x",
        "git commit --mess x --all",
      ]) {
        expect(commit(command).decision, command).toBe("deny");
      }
    });

    it("measures an amended commit as a whole", () => {
      stage("app/a.ts", 300);
      save("a");
      stage("app/b.ts", 300);
      expect(commit("git commit -m x").decision).toBeUndefined();
      expect(commit("git commit --amend --no-edit").decision).toBe("deny");
    });

    it("counts files that `git rm` in the same command removes", () => {
      stage("app/big.ts", 900);
      save("big");
      expect(commit("git rm app/big.ts && git commit -m rm").decision).toBe("deny");
    });

    it("allows the split sequence the deny message recommends", () => {
      write("app/a.ts", 300);
      write("app/b.ts", 300);
      const split = "git add app/a.ts && git commit -m a && git add app/b.ts && git commit -m b";
      expect(commit(split).decision).toBeUndefined();
    });

    it("asks Ben when a commit changes, moves or names a guardrail file", () => {
      stage(".claude/hooks/protect-paths.mjs", 3);
      expect(commit("git commit -m x").decision).toBe("ask");
      save("hook");
      git("mv", ".claude/hooks/protect-paths.mjs", "moved.mjs");
      expect(commit("git commit -m x").decision).toBe("ask");
      git("mv", "moved.mjs", ".claude/hooks/protect-paths.mjs");
      expect(commit("echo x > .claude/hooks/protect-paths.mjs && git commit -am x").decision).toBe("ask");
      expect(commit("cat .claude/settings.json; git commit -am x").decision).toBeUndefined();
      expect(commit("sort < .claude/settings.json > out.txt && git commit -am x").decision).toBeUndefined();
    });

    it("asks when a command before the commit removes a folder that holds guardrails, the repo root included", () => {
      stage("app/a.ts", 3);
      for (const command of [
        "rm -rf .claude && git commit -am x",
        "rm -rf . && git commit -am x",
        "cd app && rm -rf .. && git commit -am x",
        'cd "$(git rev-parse --show-toplevel)" && rm .claude/settings.json && git commit -am x',
        "(cd app) && rm .claude/settings.json && git commit -am x",
      ]) {
        expect(commit(command).decision, command).toBe("ask");
      }
      // A folder without guarded files is fine, unless the commit then takes its removal along (-a, tracked files).
      expect(commit("rm -rf tmp && git commit -am x").decision).toBeUndefined();
      expect(commit("rm -rf app && git commit -m x").decision).toBeUndefined();
      expect(commit("rm -rf app && git commit -am x").decision).toBe("ask");
      expect(commit("git commit -m x && rm -rf .claude").decision).toBeUndefined();
    });

    it("asks when the commit's directory or the writes before it cannot be known", () => {
      stage("app/a.ts", 3);
      expect(commit('cd "$DIR" && git commit -m x').decision).toBe("ask");
      expect(commit("patch -p1 < fix.diff && git commit -am x").decision).toBe("ask");
      expect(commit('rm "$F" && git commit -am x').decision).toBe("ask");
    });
  });

  describe("prediction edge cases from the review", () => {
    const commitHere = (...args: string[]) =>
      git("-c", "user.email=t@example.test", "-c", "user.name=t", "commit", "-q", ...args);

    it("counts a rename once, staged or still to be made by `git mv`", () => {
      stage("app/big.ts", 300);
      commitHere("-m", "big");
      expect(commit("git mv app/big.ts app/big2.ts && git commit -m x").decision).toBeUndefined();
      git("mv", "app/big.ts", "app/big2.ts");
      expect(commit("git commit -m x").decision).toBeUndefined();
    });

    it("still measures the index when a git call in the prediction fails", () => {
      stage("app/big.ts", 500);
      expect(commit("git add /etc/hosts; git commit -m x").decision).toBe("deny");
    });

    it("measures the staged index of every repo the line commits in", () => {
      const other = mkdtempSync(path.join(tmpdir(), "commit-size-other-"));
      try {
        execFileSync("git", ["init", "-q"], { cwd: other, stdio: "ignore" });
        writeFileSync(path.join(other, "big.ts"), lines(500));
        execFileSync("git", ["add", "big.ts"], { cwd: other, stdio: "ignore" });
        stage("app/small.ts", 5);
        expect(commit(`git commit -q -m x && git -C ${other} commit -m y`).decision).toBe("deny");
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });

    it("does not count the whole tree for `git add -A <path>` or partial adds", () => {
      stage("app/a.ts", 5);
      commitHere("-m", "a");
      writeFileSync(path.join(repo, "app/a.ts"), lines(600).replaceAll("line", "row"));
      stage("docs/n.md", 1);
      for (const c of [
        "git add -A docs && git commit -m x",
        "git add -p && git commit -m x",
        "git add -N docs && git commit -m x",
      ]) {
        expect(commit(c).decision, c).toBeUndefined();
      }
      expect(commit("git add -A && git commit -m x").decision).toBe("deny");
    });

    it("follows `cd $(…)` and backticks, and treats `cd -`/`popd` as unknown", () => {
      writeFileSync(path.join(repo, "big.ts"), lines(500));
      expect(commit("cd $(git rev-parse --show-toplevel) && git add -A && git commit -m x").decision).toBe("deny");
      expect(commit("git add -A && git -C `git rev-parse --show-toplevel` commit -m x").decision).toBe("deny");
      expect(commit("cd - && git add -A && git commit -m x").decision).toBe("ask");
      expect(commit("popd && git commit -m x").decision).toBe("ask");
    });

    it("expands globs and treats inline interpreter code as unknown", () => {
      stage(".claude/settings.json", 1);
      commitHere("-m", "settings");
      expect(commit("rm -rf .claude/* && git commit -am x").decision).toBe("ask");
      expect(commit("sed -i '' 's/a/b/' .claude/settings*.json && git commit -am x").decision).toBe("ask");
      expect(commit("perl -e 'print 1' && git commit -am x").decision).toBe("ask");
      expect(commit("python3 - <<'EOF'\nprint(1)\nEOF\ngit commit -am x").decision).toBe("ask");
    });

    it("asks for writes the commit takes from the working tree, counts a staged mv once, and --only paths", () => {
      stage("app/big.ts", 300);
      commitHere("-m", "big");
      expect(commit("sed -i '' 's/^/x/' app/big.ts && git add -A && git commit -m x").decision).toBe("ask");
      // Writes after the last `git add` do not reach a commit without -a.
      expect(commit("git add -A && echo x > lint.txt; git commit -m x").decision).toBeUndefined();
      // Interpreters with options only and glob words that are no valid pattern neither ask nor crash.
      expect(commit("node --version && git commit -m x").decision).toBeUndefined();
      execFileSync("mv", [path.join(repo, "app/big.ts"), path.join(repo, "app/renamed.ts")]);
      // Before staging a plain mv counts as delete plus add (more, never less); once staged, git sees the rename.
      expect(commit("git add -A && git commit -m mv").decision).toBe("deny");
      git("add", "-A");
      expect(commit("git commit -m mv").decision).toBeUndefined();
      expect(commit('echo y > "a[1" && git commit -m mv').decision).toBeUndefined();
      commitHere("-m", "mv");
      stage("app/other.ts", 500);
      writeFileSync(path.join(repo, "app/renamed.ts"), "changed\n");
      expect(commit("git commit -m x app/renamed.ts").decision).toBeUndefined();
      expect(commit("git commit -i -m x app/renamed.ts").decision).toBe("deny");
    });

    it("sees commits behind timeout and nice", () => {
      stage("app/big.ts", 500);
      for (const c of ["timeout 30 git commit -m x", "nice -n 5 git commit -m x"]) {
        expect(commit(c).decision, c).toBe("deny");
      }
    });
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
