import { describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import { importDemoData } from "~/lib/db/demo-data";
import { createTestDb } from "../../../tests/helpers/db";
import { budgetStatus, subscriptionOverview } from "./index";

describe("Budget „Abos & Software“ und die Abo-Seite erzählen dasselbe", () => {
  it("die Hochrechnung des Budgets ist die Monatssumme der Abos dieser Kategorie", async () => {
    const { db } = await createTestDb();
    await importDemoData(db, createMockModel());
    const now = new Date("2026-10-12T10:00:00Z");
    const { recurring } = await subscriptionOverview(db, now);
    const monthly = recurring
      .filter((r) => r.active && r.cadence === "monthly" && r.categoryName === "Abos & Software")
      .reduce((s, r) => s - r.lastAmountCents, 0);
    const { items } = await budgetStatus(db, now);
    const abos = items.find((b) => b.categoryName === "Abos & Software");
    expect(monthly).toBeGreaterThan(0);
    expect(abos?.projectedCents).toBe(monthly);
  });
});
