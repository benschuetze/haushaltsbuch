import { createHash, timingSafeEqual } from "node:crypto";
import { createCookieSessionStorage, redirect } from "react-router";

export function isDemo(): boolean {
  return process.env.DEMO_MODE === "true";
}

const sessionStorage = createCookieSessionStorage<{ loggedIn: true }>({
  cookie: {
    name: "hb_session",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // E2E runs the production build over plain http; WebKit drops Secure cookies there, Chromium does not.
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    maxAge: 60 * 60 * 24 * 30,
    secrets: [process.env.SESSION_SECRET || "nur-fuer-lokale-entwicklung"],
  },
});

export async function isLoggedIn(request: Request): Promise<boolean> {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  return session.get("loggedIn") === true;
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
  const session = await sessionStorage.getSession();
  session.set("loggedIn", true);
  return redirect(safeRedirect(redirectTo), {
    headers: { "Set-Cookie": await sessionStorage.commitSession(session) },
  });
}

export async function logOut(request: Request): Promise<Response> {
  const session = await sessionStorage.getSession(request.headers.get("Cookie"));
  return redirect("/login", { headers: { "Set-Cookie": await sessionStorage.destroySession(session) } });
}

/** Only same-site paths; "//evil.example" would otherwise be followed as a protocol-relative URL. */
export function safeRedirect(to: string | null | undefined): string {
  if (!to?.startsWith("/") || to.startsWith("//") || to.startsWith("/\\")) return "/";
  return to;
}

const PUBLIC_PATHS = new Set(["/login"]);

/**
 * One gate for every loader and action. Demo: read-only for everyone. Private instance: nothing without login.
 */
export async function guard(request: Request): Promise<void> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\.data$/, "") || "/";
  const writing = request.method !== "GET" && request.method !== "HEAD";

  if (isDemo()) {
    if (writing) throw new Response("Die Demo ist schreibgeschützt.", { status: 403 });
    if (PUBLIC_PATHS.has(path)) throw redirect("/");
    return;
  }
  if (PUBLIC_PATHS.has(path)) return;
  if (!(await isLoggedIn(request))) {
    if (writing) throw new Response("Nicht angemeldet.", { status: 401 });
    throw redirect(`/login?next=${encodeURIComponent(path + url.search)}`);
  }
}
