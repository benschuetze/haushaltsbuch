import pino, { type DestinationStream, type Logger } from "pino";
import { type Report, report } from "./sentry.server";

/**
 * Structured logs: one JSON line per event on stdout, which Vercel stores and makes searchable by field.
 * Every entry carries an `event` name, so logs and alerts can be filtered without parsing German sentences.
 */

// Fields that could carry banking data or credentials. Code should not log them; this catches the slip.
const REDACT = [
  "iban",
  "raw",
  "purpose",
  "counterparty",
  "*.iban",
  "*.raw",
  "*.purpose",
  "*.counterparty",
  "headers.cookie",
  "headers.authorization",
  "*.headers.cookie",
  "*.headers.authorization",
];

const SENSITIVE = new Set(["iban", "raw", "purpose", "counterparty", "headers"]);

/** pino's redact only touches the log line; fields headed for Sentry need the same treatment. */
function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE.has(key)) continue;
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) ? scrub(value as Record<string, unknown>) : value;
  }
  return out;
}

type Reporter = (r: Report) => Promise<void>;

export function createLogger(destination?: DestinationStream, reporter: Reporter = report): Logger {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? (process.env.VITEST ? "silent" : "info"),
      base: { service: "haushaltsbuch", env: process.env.VERCEL_ENV ?? process.env.NODE_ENV },
      redact: { paths: REDACT, censor: "[geschwärzt]" },
      formatters: { level: (label) => ({ level: label }) },
      hooks: {
        // Warnings and errors also go to Sentry, so the logger is the one place code has to call.
        logMethod(args, method, level) {
          if (level >= 40) {
            const [first, second] = args as unknown[];
            const fields = typeof first === "object" && first !== null ? (first as Record<string, unknown>) : {};
            const message = typeof first === "string" ? first : typeof second === "string" ? second : "";
            const { event, ...extra } = fields;
            void reporter({
              level: level >= 50 ? "error" : "warning",
              message,
              event: typeof event === "string" ? event : undefined,
              extra: scrub(extra),
            }).catch(() => {});
          }
          method.apply(this, args as Parameters<typeof method>);
        },
      },
    },
    destination,
  );
}

export const log = createLogger();
