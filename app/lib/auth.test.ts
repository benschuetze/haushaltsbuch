// Test values are generated at runtime so no credential-looking literal ends up in the repo.
import { randomUUID } from "node:crypto";
import { createCookieSessionStorage } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guard, isLoggedIn, loginConfigured, passwordMatches, safeRedirect } from "./auth.server";

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
    const configured = randomUUID();
    vi.stubEnv("APP_PASSWORD", configured);
    expect(passwordMatches(configured)).toBe(true);
    expect(passwordMatches(randomUUID())).toBe(false);
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

describe("Session-Secret", () => {
  async function forgedCookie(secret: string): Promise<string> {
    const storage = createCookieSessionStorage({ cookie: { name: "hb_session", secrets: [secret] } });
    const session = await storage.getSession();
    session.set("loggedIn", true);
    return (await storage.commitSession(session)).split(";")[0] as string;
  }

  it("ohne SESSION_SECRET in Produktion lässt sich kein Login-Cookie fälschen", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "");
    const cookie = await forgedCookie("nur-fuer-lokale-entwicklung");
    expect(await isLoggedIn(new Request("http://x/", { headers: { Cookie: cookie } }))).toBe(false);
  });

  it("ein zu kurzes SESSION_SECRET zählt in Produktion als fehlend", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_PASSWORD", randomUUID());
    vi.stubEnv("SESSION_SECRET", randomUUID().slice(0, 8));
    expect(loginConfigured()).toBe(false);
  });

  it("mit gesetztem Secret gilt ein damit signiertes Cookie als angemeldet", async () => {
    const secret = randomUUID() + randomUUID();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", secret);
    const cookie = await forgedCookie(secret);
    expect(await isLoggedIn(new Request("http://x/", { headers: { Cookie: cookie } }))).toBe(true);
  });
});

describe("Favicon", () => {
  it("ist ohne Login erreichbar, privat wie in der Demo", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    expect(await outcome(new Request("http://x/favicon.ico"))).toBe("ok");
    vi.stubEnv("DEMO_MODE", "true");
    expect(await outcome(new Request("http://x/favicon.ico"))).toBe("ok");
  });
});
