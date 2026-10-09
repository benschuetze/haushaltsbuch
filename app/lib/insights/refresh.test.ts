import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import type { Db } from "~/lib/db/client";
import { accounts, budgets, categories, insights } from "~/lib/db/schema";
import { DEFAULT_BUDGETS, seed } from "~/lib/db/seed";
import { importCsv } from "~/lib/import/run";
import { createTestDb } from "../../../tests/helpers/db";
import { budgetStatus, dismissInsight, notificationSummary, openInsights, refreshInsights } from "./index";

let db: Db;
let foodId: string;
const october = new Date("2026-10-09T12:00:00Z");

beforeEach(async () => {
  ({ db } = await createTestDb());
  const [account] = await db.select().from(accounts);
  if (!account) throw new Error("Demo-Konto fehlt");
  await importCsv(db, {
    accountId: account.id,
    filename: "demo.csv",
    bytes: new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv")),
    model: createMockModel(),
  });
  const [food] = await db.select().from(categories).where(eq(categories.name, "Lebensmittel"));
  foodId = food?.id ?? "";
});

describe("Standardbudgets", () => {
  it("werden einmal angelegt und kommen nach dem Löschen nicht zurück", async () => {
    expect(await db.$count(budgets)).toBe(Object.keys(DEFAULT_BUDGETS).length);
    await db.delete(budgets).where(eq(budgets.categoryId, foodId));
    await seed(db);
    expect(await db.$count(budgets, eq(budgets.categoryId, foodId))).toBe(0);
  });
});

describe("refreshInsights", () => {
  it("Budget gerissen: Hinweis erscheint, Wegklicken hält, nicht mehr zutreffend verschwindet er", async () => {
    await db.update(budgets).set({ amountCents: 10000 }).where(eq(budgets.categoryId, foodId));
    await refreshInsights(db, october);
    const exceeded = (await openInsights(db)).filter((i) => i.title === "Budget Lebensmittel überschritten");
    expect(exceeded).toHaveLength(1);
    // September is the reference: October has no bookings yet in the demo data.
    expect(exceeded[0]?.month).toBe("2026-09");
    expect((await notificationSummary(db)).unreadInsights).toBeGreaterThan(0);

    await dismissInsight(db, exceeded[0]?.id ?? "");
    await refreshInsights(db, october);
    expect((await openInsights(db)).some((i) => i.title === "Budget Lebensmittel überschritten")).toBe(false);
    expect(await db.$count(insights, eq(insights.title, "Budget Lebensmittel überschritten"))).toBe(1);
  });

  it("nicht weggeklickte Hinweise verschwinden, wenn sie nicht mehr gelten", async () => {
    await db.update(budgets).set({ amountCents: 10000 }).where(eq(budgets.categoryId, foodId));
    await refreshInsights(db, october);
    await db.update(budgets).set({ amountCents: 100000 }).where(eq(budgets.categoryId, foodId));
    await refreshInsights(db, october);
    expect(await db.$count(insights, eq(insights.title, "Budget Lebensmittel überschritten"))).toBe(0);
  });

  it("zweimal rechnen legt nichts doppelt an", async () => {
    await refreshInsights(db, october);
    const first = await db.$count(insights);
    await refreshInsights(db, october);
    expect(await db.$count(insights)).toBe(first);
  });
});

describe("budgetStatus", () => {
  it("rechnet die Ausgaben je Budget für den Bezugsmonat, Umbuchungen nicht mit", async () => {
    const { month, items } = await budgetStatus(db, october);
    expect(month).toBe("2026-09");
    // REWE 63,12 + 77,30, ALDI 41,87, Lidl 35,60, Bäckerei 8,40 in September.
    expect(items.find((i) => i.categoryName === "Lebensmittel")).toMatchObject({
      spentCents: 22629,
      budgetCents: 45000,
      projectedCents: null,
    });
  });
});
