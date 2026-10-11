import { describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import { imports } from "~/lib/db/schema";
import { openInsights, refreshInsights, spendingToday, subscriptionOverview } from "~/lib/insights";
import { createTestDb } from "../../../tests/helpers/db";
import { importDemoData } from "./demo-data";

const october = new Date("2026-10-09T12:00:00Z");

describe("öffentliche Demo", () => {
  it("zeigt, was die App kann: Abos, Preiserhöhung, doppelter Streamingdienst, PayPal ohne Doppelzählung", async () => {
    const { db } = await createTestDb();
    expect(await importDemoData(db, createMockModel())).toBeGreaterThan(150);
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
    await importDemoData(db, createMockModel());
    const { upcoming } = await spendingToday(db, october);
    const names = upcoming.map((u) => u.name);
    expect(names.filter((n) => /netflix/i.test(n))).toHaveLength(1);
    expect(names.some((n) => /aral/i.test(n))).toBe(false);
  });

  it("ein zweiter Lauf (nächster Deploy) legt nichts doppelt an, auch keine Import-Einträge", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, null);
    const before = await db.$count(imports);
    expect(await importDemoData(db, null)).toBe(0);
    expect(await db.$count(imports)).toBe(before);
  });
});
