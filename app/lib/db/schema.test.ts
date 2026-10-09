import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../tests/helpers/db";
import { accounts, categories, imports, transactions } from "./schema";
import { DEFAULT_CATEGORIES, seed } from "./seed";

describe("Datenbank", () => {
  it("Migrationen laufen durch und der Seed legt die Standardkategorien an", async () => {
    const { db } = await createTestDb();
    const rows = await db.select().from(categories).orderBy(categories.sortOrder);
    expect(rows.map((c) => c.name)).toEqual(DEFAULT_CATEGORIES.map((c) => c.name));
  });

  it("Seed ist wiederholbar, ohne Kategorien doppelt anzulegen", async () => {
    const { db } = await createTestDb();
    await seed(db);
    await seed(db);
    expect(await db.$count(categories)).toBe(DEFAULT_CATEGORIES.length);
    expect(await db.$count(accounts)).toBe(1);
  });

  it("derselbe dedupe_hash kann nicht zweimal gespeichert werden", async () => {
    const { db } = await createTestDb();
    const [account] = await db.select().from(accounts);
    if (!account) throw new Error("Demo-Konto fehlt");
    const [imp] = await db
      .insert(imports)
      .values({ accountId: account.id, filename: "a.csv", rowCount: 1 })
      .returning();
    if (!imp) throw new Error("Import fehlt");
    const tx = {
      accountId: account.id,
      importId: imp.id,
      bookingDate: "2026-08-01",
      amountCents: -100,
      counterparty: "A",
      purpose: "B",
      raw: {},
      dedupeHash: "same",
    };
    await db.insert(transactions).values(tx);
    await expect(db.insert(transactions).values(tx)).rejects.toThrow();
    expect(await db.$count(transactions, eq(transactions.dedupeHash, "same"))).toBe(1);
  });
});
