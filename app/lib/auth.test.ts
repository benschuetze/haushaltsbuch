// Test values are generated at runtime so no credential-looking literal ends up in the repo.
import { randomUUID } from "node:crypto";
import { createCookieSessionStorage } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guard, isLoggedIn, logIn, loginConfigured, passwordMatches, safeRedirect } from "./auth.server";

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
  it("Demo: ohne Login lesen und ausprobieren, auch schreiben", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      expect(await outcome(new Request("http://x/buchungen", { method }))).toBe("ok");
    }
  });

  it("Demo mit DEMO_READ_ONLY=1: jeder schreibende Request wird mit 403 abgelehnt", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_READ_ONLY", "1");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(await outcome(new Request("http://x/buchungen", { method }))).toBe(403);
    }
    expect(await outcome(new Request("http://x/buchungen"))).toBe("ok");
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

describe("guard: Schnellerfassung", () => {
  it("privat: /api/capture braucht kein Login, es prüft sein eigenes Token", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    expect(await outcome(new Request("http://x/api/capture", { method: "POST" }))).toBe("ok");
    expect(await outcome(new Request("http://x/api/capture-alt", { method: "POST" }))).toBe(401);
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
    // Browsers drop tabs and newlines from URLs: "/<tab>/evil.example" would become "//evil.example".
    ["/\t/evil.example", "/"],
    ["/\n/evil.example", "/"],
    ["/\r\n/evil.example", "/"],
    ["/ok?x=1#y", "/ok?x=1#y"],
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

  it("ein Cookie mit gültiger Signatur, aber ohne Ausstellungszeit und Passwort-Bezug gilt nicht", async () => {
    const secret = randomUUID() + randomUUID();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", secret);
    vi.stubEnv("APP_PASSWORD", randomUUID());
    const cookie = await forgedCookie(secret);
    expect(await isLoggedIn(new Request("http://x/", { headers: { Cookie: cookie } }))).toBe(false);
  });
});

describe("Sitzungen", () => {
  async function loginCookie(): Promise<string> {
    const response = await logIn("/");
    return (response.headers.get("Set-Cookie") ?? "").split(";")[0] as string;
  }
  const loggedIn = (cookie: string) => isLoggedIn(new Request("http://x/", { headers: { Cookie: cookie } }));

  function configure() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", randomUUID() + randomUUID());
    vi.stubEnv("APP_PASSWORD", randomUUID());
  }
  afterEach(() => vi.useRealTimers());

  it("nach dem Anmelden gilt die Sitzung", async () => {
    configure();
    expect(await loggedIn(await loginCookie())).toBe(true);
  });

  it("nach 7 Tagen ist sie ungültig, auch wenn ein Gerät das Cookie weiter schickt", async () => {
    configure();
    vi.useFakeTimers({ now: new Date("2026-10-01T10:00:00Z") });
    const cookie = await loginCookie();
    vi.setSystemTime(new Date("2026-10-08T09:00:00Z"));
    expect(await loggedIn(cookie)).toBe(true);
    vi.setSystemTime(new Date("2026-10-08T11:00:00Z"));
    expect(await loggedIn(cookie)).toBe(false);
  });

  it("ein Passwortwechsel meldet alle bestehenden Sitzungen ab", async () => {
    configure();
    const cookie = await loginCookie();
    vi.stubEnv("APP_PASSWORD", randomUUID());
    expect(await loggedIn(cookie)).toBe(false);
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

describe("Assistent in der schreibgeschützten Demo", () => {
  it("darf gefragt werden, alles andere Schreibende bleibt gesperrt", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DEMO_READ_ONLY", "1");
    expect(await outcome(new Request("http://x/assistent", { method: "POST" }))).toBe("ok");
    expect(await outcome(new Request("http://x/assistent.data", { method: "POST" }))).toBe("ok");
    expect(await outcome(new Request("http://x/regeln", { method: "POST" }))).toBe(403);
  });
});
