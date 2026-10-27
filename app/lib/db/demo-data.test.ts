import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import { imports, transactions } from "~/lib/db/schema";
import { openInsights, refreshInsights, spendingToday, subscriptionOverview } from "~/lib/insights";
import { createTestDb } from "../../../tests/helpers/db";
import { demoMonthShift, importDemoData } from "./demo-data";

const october = new Date("2026-10-09T12:00:00Z");
const read = undefined;

describe("öffentliche Demo", () => {
  it("zeigt, was die App kann: Abos, Preiserhöhung, doppelter Streamingdienst, PayPal ohne Doppelzählung", async () => {
    const { db } = await createTestDb();
    expect(await importDemoData(db, createMockModel(), read, october)).toBeGreaterThan(150);
    await refreshInsights(db, october);
    const insightsList = await openInsights(db, 100);
    const titles = insightsList.map((i) => i.title);

    expect(titles).toContain("Spotify AB ist teurer geworden");
    expect(titles).toContain("2× Video-Streaming");
    const abos = insightsList.find((i) => i.kind === "subscription_found");
    expect(abos?.title).toMatch(/^\d+ Abos erkannt$/);
    expect(abos?.body).toContain("FitX Deutschland GmbH");
    expect(abos?.body).toContain("Netflix International B.V.");

    // Netflix is paid via PayPal: one subscription, not a second one hiding behind "PayPal Europe".
    const { recurring } = await subscriptionOverview(db, october);
    expect(recurring.filter((r) => /netflix|paypal/i.test(r.merchant)).map((r) => r.merchant)).toEqual([
      "Netflix International B.V.",
    ]);
  });

  it("„noch fällig“: jede Zahlung einmal (PayPal und Girokonto), Tanken ist keine feste Abbuchung", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, createMockModel(), read, october);
    const { upcoming } = await spendingToday(db, october);
    const names = upcoming.map((u) => u.name);
    expect(names.filter((n) => /netflix/i.test(n))).toHaveLength(1);
    expect(names.some((n) => /aral/i.test(n))).toBe(false);
  });

  it("ein zweiter Lauf (nächster Deploy) legt nichts doppelt an, auch keine Import-Einträge", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, null, read, october);
    const before = await db.$count(imports);
    expect(await importDemoData(db, null, read, october)).toBe(0);
    expect(await db.$count(imports)).toBe(before);
  });

  it("die Beispielmonate wandern mit dem Kalender: im Dezember liegt die August-Abbuchung im Oktober", async () => {
    expect(demoMonthShift(october)).toBe(0);
    expect(demoMonthShift(new Date("2026-12-15T12:00:00Z"))).toBe(2);
    expect(demoMonthShift(new Date("2027-03-01T12:00:00Z"))).toBe(5);
    // Never backwards: the files are not meant for a "today" before October 2026.
    expect(demoMonthShift(new Date("2026-06-01T12:00:00Z"))).toBe(0);

    const { db } = await createTestDb();
    await importDemoData(db, null, read, new Date("2026-12-15T12:00:00Z"));
    const spotify = (
      await db
        .select({ date: transactions.bookingDate })
        .from(transactions)
        .where(eq(transactions.counterparty, "Spotify AB"))
    )
      .map((r) => r.date)
      .sort();
    // 07.08. and 07.09. in the main file, 07.10. in the history: two months later each.
    expect(spotify).toContain("2026-10-07");
    expect(spotify).toContain("2026-11-07");
    expect(spotify.at(-1)).toBe("2026-12-07");
    // Still a live subscription in December, which is the point of the shift.
    const { recurring } = await subscriptionOverview(db, new Date("2026-12-15T12:00:00Z"));
    expect(recurring.find((r) => r.merchant === "Spotify AB")?.active).toBe(true);
  });
});
