import type * as SentryType from "@sentry/node";

/**
 * Error reporting to Sentry, server only. Without SENTRY_DSN nothing is loaded or sent, so local runs, tests and the
 * demo stay offline. The browser does not report: the CSP allows connections only to the own server.
 *
 * What may leave the server: the error name, a shortened message (see safeError) and our own context fields.
 * No request bodies, cookies, headers or IPs, and nothing from bookings.
 */
let sentry: Promise<typeof SentryType | null> | null = null;

function load(): Promise<typeof SentryType | null> {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return Promise.resolve(null);
  sentry ??= import("@sentry/node").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      sendDefaultPii: false,
      // No automatic instrumentation: it would attach request data and spans we do not want to ship.
      defaultIntegrations: false,
      integrations: [],
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
    });
    return Sentry;
  });
  return sentry;
}

/** Last line of defence: drop whatever an SDK update might attach about the request or the user. */
export function scrubEvent<T extends { request?: unknown; user?: unknown; breadcrumbs?: unknown }>(event: T): T {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  return event;
}

export type Report = { level: "error" | "warning"; message: string; event?: string; extra?: Record<string, unknown> };

export async function report({ level, message, event, extra }: Report): Promise<void> {
  const Sentry = await load();
  if (!Sentry) return;
  Sentry.captureMessage(message, {
    level,
    // Group by our event name, not by the varying message text, so one cause is one issue (and one alert).
    fingerprint: event ? [event] : undefined,
    tags: event ? { event } : undefined,
    extra,
  });
}

/** Serverless functions freeze after the response; call this where the response can wait a moment. */
export async function flushReports(timeoutMs = 2000): Promise<void> {
  const Sentry = await load();
  if (Sentry) await Sentry.flush(timeoutMs);
}
