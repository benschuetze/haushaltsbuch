import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import { takeFromDailyBudget } from "~/lib/daily-budget.server";
import { importDemoData } from "~/lib/db/demo-data";
import { budgets, categories, meta, rules, savingsGoals, transactions } from "~/lib/db/schema";
import { createTestDb } from "../../tests/helpers/db";
import { RESET_BUDGET, resetDemo, resetDemoNightly } from "./demo-reset.server";

async function counts(db: Awaited<ReturnType<typeof createTestDb>>["db"]) {
  const n = async (t: typeof transactions | typeof rules | typeof budgets | typeof savingsGoals) =>
    (await db.select({ c: sql<number>`count(*)::int` }).from(t))[0]?.c;
  return {
    bookings: await n(transactions),
    rules: await n(rules),
    budgets: await n(budgets),
    goals: await n(savingsGoals),
  };
}

describe("Demo zurücksetzen", () => {
  it("was Besucher geändert haben, ist danach weg; die Beispieldaten sind wieder da", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, createMockModel());
    const fresh = await counts(db);

    const [food] = await db.select().from(categories).where(eq(categories.name, "Lebensmittel"));
    await db
      .insert(rules)
      .values({ field: "counterparty", matchType: "contains", pattern: "kiosk", categoryId: food?.id ?? "" });
    await db.insert(savingsGoals).values({ name: "Mallorca", targetCents: 80000, dueMonth: null, monthlyCents: 10000 });
    await db.insert(categories).values({ name: "Testkategorie", kind: "expense", color: "#000000", sortOrder: 99 });
    await db.delete(transactions);
    await db.delete(budgets);

    await resetDemo(db);
    expect(await counts(db)).toEqual(fresh);
    expect(await db.select().from(categories).where(eq(categories.name, "Testkategorie"))).toEqual([]);
  });

  it("das Tageslimit für Modellaufrufe bleibt: Zurücksetzen gibt kein neues Kontingent", async () => {
    const { db } = await createTestDb();
    const now = new Date("2026-10-12T10:00:00Z");
    await takeFromDailyBudget(db, "assistant", 30, 30, now);
    await resetDemo(db);
    expect(await takeFromDailyBudget(db, "assistant", 1, 30, now)).toBe(0);
  });

  it("nachts genau einmal: die erste Anfrage des Tages setzt zurück, die nächsten nicht", async () => {
    const { db } = await createTestDb();
    const night = new Date("2026-10-13T01:00:00Z");
    expect(await resetDemoNightly(db, night)).toBe(true);
    expect(await resetDemoNightly(db, night)).toBe(false);
    const claims = await db.select().from(meta).where(sql`${meta.key} like 'demo_reset_%'`);
    expect(claims).toHaveLength(1);
  });

  it("nach dem nächtlichen Reset funktioniert der Knopf am selben Tag", async () => {
    const { db } = await createTestDb();
    const morning = new Date("2026-10-20T06:00:00Z");
    expect(await resetDemoNightly(db, morning)).toBe(true);
    // The button's daily allowance must not trip over the nightly claim of the same day.
    expect(await takeFromDailyBudget(db, RESET_BUDGET, 1, 100, morning)).toBe(1);
  });
});
