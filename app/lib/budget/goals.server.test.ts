import { describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import { importDemoData } from "~/lib/db/demo-data";
import { purchasePlan, spendingToday } from "~/lib/insights";
import { createTestDb } from "../../../tests/helpers/db";
import { createGoal, deposit, loadGoalInputs } from "./goals.server";

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

  it("Kaufplanung mit den Demo-Daten nennt einen Monat in der Zukunft", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, createMockModel());
    const { plan } = await purchasePlan(db, 500000, october);
    expect(plan.surplusPerMonthCents).toBeGreaterThan(0);
    expect(plan.month && plan.month > "2026-10").toBe(true);
  });
});
