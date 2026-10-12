import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import { importDemoData } from "~/lib/db/demo-data";
import { transactions } from "~/lib/db/schema";
import { purchasePlan, spendingToday } from "~/lib/insights";
import { createTestDb } from "../../../tests/helpers/db";
import { createGoal, deposit, loadGoalInputs, savingsPlan } from "./goals.server";

const october = new Date("2026-10-09T12:00:00Z");

describe("Sparziele in der Datenbank", () => {
  it("Einzahlen bis zum Ziel meldet das Erreichen genau einmal; erreichte reservieren nichts mehr", async () => {
    const { db } = await createTestDb();
    const id = await createGoal(db, { name: "Fahrrad", targetCents: 30000, dueMonth: null, monthlyCents: 10000 });
    expect(await deposit(db, id, 20000, "2026-10-01")).toBe(false);
    expect(await deposit(db, id, 10000, "2026-10-02")).toBe(true);
    expect(await deposit(db, id, 500, "2026-10-03")).toBe(false);
    expect(await loadGoalInputs(db)).toEqual([]);
    expect((await loadGoalInputs(db, { includeAchieved: true }))[0]?.deposits).toHaveLength(3);
  });

  it("ein Ziel senkt das Tagesbudget um seine offene Monatsrate", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, createMockModel());
    const before = await spendingToday(db, october);
    await createGoal(db, { name: "Mallorca", targetCents: 80000, dueMonth: "2027-01", monthlyCents: null });
    const after = await spendingToday(db, october);
    expect(before.freeCents - after.freeCents).toBe(20000);
  });

  it("der Sparauftrag der Demo wird erkannt; als Ziel übernommen ändert er das Tagesbudget nicht", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, createMockModel());
    const plan = await savingsPlan(db, "2026-10-09");
    expect(plan).toMatchObject({ counterparty: "Eigenes Tagesgeld", monthlyCents: 30000 });
    const before = await spendingToday(db, october);
    await createGoal(db, {
      name: "Rücklage",
      targetCents: 360000,
      dueMonth: null,
      monthlyCents: 30000,
      fundedBy: plan?.key ?? null,
    });
    const after = await spendingToday(db, october);
    expect(after.freeCents).toBe(before.freeCents);
    expect(after.upcoming.map((u) => u.name)).toContain("Sparziel Rücklage");
    expect(after.upcoming.map((u) => u.name)).not.toContain("Eigenes Tagesgeld");

    // The order's next transfer arrives: it is the deposit, nothing is typed in by hand.
    const [last] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.counterparty, "Eigenes Tagesgeld"))
      .orderBy(desc(transactions.bookingDate))
      .limit(1);
    if (!last) throw new Error("Demo ohne Sparrate");
    const thisMonth = `${new Date().toISOString().slice(0, 7)}-15`;
    await db.insert(transactions).values({ ...last, id: undefined, bookingDate: thisMonth, dedupeHash: "neu" });
    const [goal] = await loadGoalInputs(db);
    expect(goal?.deposits).toEqual([{ amountCents: 30000, depositedOn: thisMonth }]);
  });

  it("Kaufplanung mit den Demo-Daten nennt einen Monat in der Zukunft", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, createMockModel());
    const { plan } = await purchasePlan(db, 500000, october);
    expect(plan.surplusPerMonthCents).toBeGreaterThan(0);
    expect(plan.month && plan.month > "2026-10").toBe(true);
  });
});
