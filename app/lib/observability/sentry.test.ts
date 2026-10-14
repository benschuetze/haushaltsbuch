import { describe, expect, it } from "vitest";
import { flushReports, report, scrubEvent } from "./sentry.server";

describe("Fehlerberichte", () => {
  it("ohne SENTRY_DSN wird nichts geladen und nichts gesendet", async () => {
    expect(process.env.SENTRY_DSN).toBeUndefined();
    await expect(report({ level: "error", message: "x", event: "x" })).resolves.toBeUndefined();
    await expect(flushReports()).resolves.toBeUndefined();
  });

  it("entfernt Anfrage, Nutzer und Verlauf aus jedem Ereignis", () => {
    const event = scrubEvent({
      message: "kaputt",
      request: { url: "/transaktionen?q=Kita", cookies: { session: "s" } },
      user: { ip_address: "203.0.113.7" },
      breadcrumbs: [{ message: "GET /transaktionen?q=Kita" }],
    });
    expect(event).toEqual({ message: "kaputt" });
  });
});
