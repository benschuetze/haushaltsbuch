import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO, runHook } from "./run-hook";

const call = (tool_name: string, file_path: string) =>
  runHook("protect-paths.mjs", JSON.stringify({ tool_name, tool_input: { file_path }, cwd: REPO }));

describe("protect-paths hook", () => {
  it("lets ordinary source files through untouched", () => {
    expect(call("Edit", path.join(REPO, "app/lib/money.ts"))).toMatchObject({ status: 0, decision: undefined });
    expect(call("Write", "app/routes/new.tsx").decision).toBeUndefined();
  });

  it("refuses hand edits to generated migrations and points to db:generate", () => {
    const result = call("Write", path.join(REPO, "drizzle/0042_new.sql"));
    expect(result.decision).toBe("deny");
    expect(result.reason).toContain("pnpm db:generate");
  });

  it("still allows reading migrations", () => {
    expect(call("Read", path.join(REPO, "drizzle/meta/_journal.json")).decision).toBeUndefined();
  });

  it("asks Ben before workflows, expected sums or the guardrails themselves change", () => {
    for (const file of [
      ".github/workflows/ci.yml",
      "beispieldaten/erwartet.json",
      ".claude/settings.json",
      ".claude/hooks/commit-size.mjs",
    ]) {
      const result = call("Edit", path.join(REPO, file));
      expect(result.decision, file).toBe("ask");
      expect(result.reason, file).toMatch(/Ben/);
    }
  });

  it("never reads or writes .env files, but .env.example stays editable", () => {
    expect(call("Read", path.join(REPO, ".env")).decision).toBe("deny");
    expect(call("Read", path.join(REPO, ".env.video")).decision).toBe("deny");
    expect(call("Edit", path.join(REPO, ".env.production.local")).decision).toBe("deny");
    expect(call("Edit", path.join(REPO, ".env.example")).decision).toBeUndefined();
  });

  it("is not fooled by case or by ../ tricks", () => {
    expect(call("Edit", path.join(REPO, "Drizzle/0001.sql")).decision).toBe("deny");
    expect(call("Edit", path.join(REPO, "app/../drizzle/0001.sql")).decision).toBe("deny");
  });

  it("ignores tools it does not guard", () => {
    expect(call("Bash", path.join(REPO, "drizzle/x.sql")).decision).toBeUndefined();
  });

  it("does not throw on broken input", () => {
    for (const stdin of [
      "",
      "not json",
      "null",
      "{}",
      '{"tool_name":"Edit"}',
      '{"tool_name":"Edit","tool_input":{"file_path":42}}',
    ]) {
      const result = runHook("protect-paths.mjs", stdin);
      expect(result.status, stdin).toBe(0);
      expect(result.decision, stdin).toBeUndefined();
      expect(result.stderr, stdin).not.toMatch(/at .*\.mjs:\d+/);
    }
  });
});
