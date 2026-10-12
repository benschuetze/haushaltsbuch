import { createHash, timingSafeEqual } from "node:crypto";
import { createCookieSessionStorage, redirect } from "react-router";

export function isDemo(): boolean {
  return process.env.DEMO_MODE === "true";
}

const MIN_SECRET_LENGTH = 32;
const DEV_SECRET = "nur-fuer-lokale-entwicklung";

/** In production a missing or weak secret means no sessions at all; a known fallback would let anyone forge one. */
function sessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= MIN_SECRET_LENGTH) return secret;
  return process.env.NODE_ENV === "production" ? null : DEV_SECRET;
}

type SessionData = { loggedIn: true; issuedAt: number; passwordVersion: string };

const SESSION_MAX_AGE_S = 60 * 60 * 24 * 7;

/**
 * Ties a session to the password it was created with: changing APP_PASSWORD logs out every device,
 * which is the only way to revoke a stateless cookie session.
 */
function passwordVersion(secret: string): string {
  return createHash("sha256")
    .update(`${secret}:${process.env.APP_PASSWORD ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

// Built per call so env changes (tests, rotated secrets after a redeploy) take effect without module state.
function sessionStorage(secret: string) {
  return createCookieSessionStorage<SessionData>({
    cookie: {
      name: "hb_session",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // E2E runs the production build over plain http; WebKit drops Secure cookies there, Chromium does not.
      secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
      // A week: long enough not to annoy, short enough that a forgotten session on a shared device expires.
      maxAge: SESSION_MAX_AGE_S,
      secrets: [secret],
    },
  });
}

/** For other signed cookies (bank redirect state). Throws in production without a strong secret. */
export function cookieSecret(): string {
  const secret = sessionSecret();
  if (!secret) throw new Response("Nicht eingerichtet: SESSION_SECRET fehlt.", { status: 503 });
  return secret;
}

export function loginConfigured(): boolean {
  return Boolean(process.env.APP_PASSWORD) && sessionSecret() !== null;
}

export async function isLoggedIn(request: Request): Promise<boolean> {
  const secret = sessionSecret();
  if (!secret) return false;
  const session = await sessionStorage(secret).getSession(request.headers.get("Cookie"));
  const issuedAt = session.get("issuedAt");
  // The browser drops the cookie after maxAge; a copied cookie does not. The server checks the age itself.
  const fresh = typeof issuedAt === "number" && Date.now() - issuedAt < SESSION_MAX_AGE_S * 1000;
  return session.get("loggedIn") === true && fresh && session.get("passwordVersion") === passwordVersion(secret);
}

/** Hashing first makes both sides the same length, which timingSafeEqual requires, without leaking the length. */
export function passwordMatches(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function logIn(redirectTo: string): Promise<Response> {
  const secret = sessionSecret();
  if (!secret) throw new Response("Login ist nicht eingerichtet.", { status: 503 });
  const storage = sessionStorage(secret);
  const session = await storage.getSession();
  session.set("loggedIn", true);
  session.set("issuedAt", Date.now());
  session.set("passwordVersion", passwordVersion(secret));
  return redirect(safeRedirect(redirectTo), {
    headers: { "Set-Cookie": await storage.commitSession(session) },
  });
}

export async function logOut(request: Request): Promise<Response> {
  const storage = sessionStorage(sessionSecret() ?? DEV_SECRET);
  const session = await storage.getSession(request.headers.get("Cookie"));
  return redirect("/login", { headers: { "Set-Cookie": await storage.destroySession(session) } });
}

/**
 * Only same-site paths. "//evil.example" would be followed as a protocol-relative URL, and browsers strip tabs
 * and newlines first, so "/<tab>/evil.example" turns into the same thing: control characters are refused.
 */
export function safeRedirect(to: string | null | undefined): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused
  if (!to?.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(to)) return "/";
  const url = new URL(to, "http://same.invalid");
  if (url.origin !== "http://same.invalid") return "/";
  return url.pathname + url.search + url.hash;
}

// Reachable without login. The cron endpoint checks its own secret; the legal pages must be public.
const PUBLIC_PATHS = new Set([
  "/login",
  "/favicon.ico",
  "/bank/sync",
  "/datenschutz",
  "/nutzungsbedingungen",
  "/impressum",
  "/theme",
]);

/**
 * One gate for every loader and action. Demo: read-only for everyone. Private instance: nothing without login.
 */
export async function guard(request: Request): Promise<void> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\.data$/, "") || "/";
  const writing = request.method !== "GET" && request.method !== "HEAD";

  if (isDemo()) {
    // The assistant only reads (and answers with the mock model in the demo), so it may be asked there.
    // The theme switch only sets a cookie in the visitor's own browser.
    if (writing && path !== "/assistent" && path !== "/theme")
      throw new Response("Die Demo ist schreibgeschützt.", { status: 403 });
    if (path === "/login") throw redirect("/");
    return;
  }
  if (PUBLIC_PATHS.has(path)) return;
  if (!(await isLoggedIn(request))) {
    if (writing) throw new Response("Nicht angemeldet.", { status: 401 });
    throw redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  }
}
