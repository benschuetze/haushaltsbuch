import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./log.server";
import type { Report } from "./sentry.server";

function capture(reporter: (r: Report) => Promise<void> = async () => {}) {
  const lines: Record<string, unknown>[] = [];
  const dest = new Writable({
    write(chunk, _enc, done) {
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  });
  const logger = createLogger(dest, reporter);
  logger.level = "info";
  return { logger, lines };
}

describe("Strukturierte Logs", () => {
  it("schreibt eine JSON-Zeile mit Ereignisname und lesbarem Level", () => {
    const { logger, lines } = capture();
    logger.info({ event: "review_share", total: 3 }, "ok");
    expect(lines[0]).toMatchObject({
      level: "info",
      event: "review_share",
      total: 3,
      msg: "ok",
      service: "haushaltsbuch",
    });
  });

  it("schwärzt Bankdaten, falls Code sie versehentlich mitgibt", () => {
    const { logger, lines } = capture();
    logger.error(
      { event: "x", iban: "DE00 1234", tx: { counterparty: "Kita", purpose: "Mai", raw: { a: 1 } } },
      "kaputt",
    );
    const text = JSON.stringify(lines[0]);
    expect(text).not.toMatch(/DE00|Kita|Mai/);
    expect(text).toContain("[geschwärzt]");
  });

  it("meldet Warnungen und Fehler an Sentry, ohne Bankdaten, Infos nicht", () => {
    const reporter = vi.fn(async (_: Report) => {});
    const { logger } = capture(reporter);
    logger.info({ event: "fine" }, "nur Info");
    logger.warn({ event: "review_share_high", share: 0.8 }, "zu viel offen");
    logger.error(
      { event: "categorize_llm_failed", err: "HTTP 401", tx: { counterparty: "Kita", amount: 5 } },
      "LLM weg",
    );
    expect(reporter).toHaveBeenCalledTimes(2);
    expect(reporter.mock.calls[0]?.[0]).toMatchObject({
      level: "warning",
      event: "review_share_high",
      extra: { share: 0.8 },
    });
    const error = reporter.mock.calls[1]?.[0];
    expect(error).toMatchObject({ level: "error", event: "categorize_llm_failed", message: "LLM weg" });
    expect(JSON.stringify(error)).not.toContain("Kita");
  });

  it("loggt weiter, wenn Sentry nicht erreichbar ist", async () => {
    const { logger, lines } = capture(async () => {
      throw new Error("Sentry down");
    });
    expect(() => logger.error({ event: "x" }, "trotzdem")).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(lines).toHaveLength(1);
  });
});
