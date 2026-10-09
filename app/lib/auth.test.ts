import { afterEach, describe, expect, it, vi } from "vitest";
import { guard, passwordMatches, safeRedirect } from "./auth.server";

afterEach(() => vi.unstubAllEnvs());

async function outcome(request: Request): Promise<number | "ok"> {
  try {
    await guard(request);
    return "ok";
  } catch (e) {
    if (e instanceof Response) return e.status;
    throw e;
  }
}

describe("guard", () => {
  it("Demo: jeder schreibende Request wird mit 403 abgelehnt, lesen geht ohne Login", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(await outcome(new Request("http://x/transaktionen", { method }))).toBe(403);
    }
    expect(await outcome(new Request("http://x/transaktionen"))).toBe("ok");
  });

  it("privat: ohne Login Weiterleitung auf /login mit Rücksprung", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    try {
      await guard(new Request("http://x/monat/2026-09?a=1"));
      expect.unreachable();
    } catch (e) {
      expect((e as Response).status).toBe(302);
      expect((e as Response).headers.get("Location")).toBe("/login?next=%2Fmonat%2F2026-09%3Fa%3D1");
    }
  });

  it("privat: Schreiben ohne Login ist 401, Login-Seite ist erreichbar", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    expect(await outcome(new Request("http://x/import", { method: "POST" }))).toBe(401);
    expect(await outcome(new Request("http://x/login"))).toBe("ok");
    expect(await outcome(new Request("http://x/login.data", { method: "POST" }))).toBe("ok");
  });
});

describe("passwordMatches", () => {
  it("vergleicht mit APP_PASSWORD und lehnt ohne gesetztes Passwort alles ab", () => {
    vi.stubEnv("APP_PASSWORD", "richtig");
    expect(passwordMatches("richtig")).toBe(true);
    expect(passwordMatches("falsch")).toBe(false);
    vi.stubEnv("APP_PASSWORD", "");
    expect(passwordMatches("")).toBe(false);
  });
});

describe("safeRedirect", () => {
  it.each([
    ["/monat/2026-09", "/monat/2026-09"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example", "/"],
    [null, "/"],
  ])("%s → %s", (input, out) => {
    expect(safeRedirect(input)).toBe(out);
  });
});
