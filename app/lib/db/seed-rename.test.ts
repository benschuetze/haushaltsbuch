import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../tests/helpers/db";
import { budgets, categories } from "./schema";
import { seed } from "./seed";

/** A database from before the rename: old name, old default budget. */
async function oldDatabase(budgetEuro: number) {
  const { db } = await createTestDb();
  const [abos] = await db.select().from(categories).where(eq(categories.name, "Abos & Verträge"));
  if (!abos) throw new Error("Kategorie fehlt");
  await db.update(categories).set({ name: "Abos & Software" }).where(eq(categories.id, abos.id));
  await db
    .update(budgets)
    .set({ amountCents: budgetEuro * 100 })
    .where(eq(budgets.categoryId, abos.id));
  return { db, id: abos.id };
}

describe("Umbenennung „Abos & Software“ → „Abos & Verträge“", () => {
  it("dieselbe Kategorie bekommt den neuen Namen, keine zweite entsteht; das alte Standardbudget wird 120 €", async () => {
    const { db, id } = await oldDatabase(50);
    await seed(db);
    await seed(db);
    const abos = await db.select().from(categories).where(eq(categories.name, "Abos & Verträge"));
    expect(abos.map((c) => c.id)).toEqual([id]);
    expect(await db.select().from(categories).where(eq(categories.name, "Abos & Software"))).toEqual([]);
    const [budget] = await db.select().from(budgets).where(eq(budgets.categoryId, id));
    expect(budget?.amountCents).toBe(12000);
  });

  it("ein selbst gesetztes Budget bleibt, wie es ist", async () => {
    const { db, id } = await oldDatabase(80);
    await seed(db);
    const [budget] = await db.select().from(budgets).where(eq(budgets.categoryId, id));
    expect(budget?.amountCents).toBe(8000);
  });
});
