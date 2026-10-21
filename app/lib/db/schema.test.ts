import { eq, isNull } from "drizzle-orm";
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

  describe("Schnellerfassung", () => {
    async function setup() {
      const { db } = await createTestDb();
      const [account] = await db.select().from(accounts);
      if (!account) throw new Error("Demo-Konto fehlt");
      const [imp] = await db
        .insert(imports)
        .values({ accountId: account.id, filename: "a.csv", rowCount: 1 })
        .returning();
      if (!imp) throw new Error("Import fehlt");
      let n = 0;
      const tx = (extra: Partial<typeof transactions.$inferInsert> = {}) => ({
        accountId: account.id,
        importId: imp.id,
        bookingDate: "2026-08-01",
        amountCents: -100,
        counterparty: "A",
        purpose: "B",
        raw: {},
        dedupeHash: `hash-${++n}`,
        ...extra,
      });
      return { db, account, tx };
    }

    it("Buchungen ohne Angabe gelten als Import", async () => {
      const { db, tx } = await setup();
      const [row] = await db.insert(transactions).values(tx()).returning();
      expect(row?.source).toBe("import");
      expect(row?.captureText).toBeNull();
      expect(row?.captureKey).toBeNull();
    });

    it("derselbe capture_key im selben Konto bucht nicht zweimal", async () => {
      const { db, tx } = await setup();
      const voice = { source: "voice" as const, captureText: "fünf Euro Brötchen", captureKey: "k1" };
      await db.insert(transactions).values(tx(voice));
      await expect(db.insert(transactions).values(tx(voice))).rejects.toThrow();
      expect(await db.$count(transactions, eq(transactions.captureKey, "k1"))).toBe(1);
    });

    it("derselbe capture_key in einem anderen Konto ist erlaubt", async () => {
      const { db, account, tx } = await setup();
      const [other] = await db.insert(accounts).values({ name: "Zweitkonto", bankProfile: "sparkasse" }).returning();
      if (!other) throw new Error("Konto fehlt");
      await db.insert(transactions).values(tx({ source: "voice", captureKey: "k2" }));
      await db.insert(transactions).values(tx({ accountId: other.id, source: "voice", captureKey: "k2" }));
      expect(await db.$count(transactions, eq(transactions.captureKey, "k2"))).toBe(2);
      expect(account.id).not.toBe(other.id);
    });

    it("eine Sprachbuchung braucht keinen Import", async () => {
      const { db, tx } = await setup();
      const [row] = await db
        .insert(transactions)
        .values(tx({ importId: null, source: "voice", captureKey: "k3" }))
        .returning();
      expect(row?.importId).toBeNull();
    });

    it("Buchungen ohne capture_key kollidieren nie", async () => {
      const { db, tx } = await setup();
      await db.insert(transactions).values(tx());
      await db.insert(transactions).values(tx());
      await db.insert(transactions).values(tx({ source: "voice" }));
      expect(await db.$count(transactions, isNull(transactions.captureKey))).toBe(3);
    });
  });
});
