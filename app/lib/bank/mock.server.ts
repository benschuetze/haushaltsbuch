import { and, count, eq, inArray, like } from "drizzle-orm";
import { clockNow } from "~/lib/clock";
import type { Db } from "~/lib/db/client";
import { accounts, categories, imports, transactions } from "~/lib/db/schema";
import { refreshInsights } from "~/lib/insights";
import type { BankTile } from "./catalog";
import { mockBookings } from "./mock-data";

const PREFIX = "mock:";

/**
 * A pretend connection: an account marked as mock, filled with invented bookings. Connecting twice keeps
 * the first one; removing takes the account and everything in it away again.
 */
export async function connectMock(
  db: Db,
  tile: Pick<BankTile, "id" | "name">,
  now = clockNow(),
): Promise<{ accountName: string; inserted: number; existed: boolean }> {
  const key = `${PREFIX}${tile.id}`;
  const name = `${tile.name} (Mock)`;
  const [existing] = await db.select().from(accounts).where(eq(accounts.accountKey, key));
  if (existing) return { accountName: existing.name, inserted: 0, existed: true };

  const [account] = await db.insert(accounts).values({ name, bankProfile: "mock", accountKey: key }).returning();
  if (!account) throw new Error("Mock-Konto konnte nicht angelegt werden");
  const bookings = mockBookings(tile.id, now.toISOString().slice(0, 10));
  const [imp] = await db
    .insert(imports)
    .values({ accountId: account.id, filename: `${tile.name} (Mockdaten)`, rowCount: bookings.length })
    .returning({ id: imports.id });
  if (!imp) throw new Error("Import konnte nicht angelegt werden");

  const byName = new Map((await db.select().from(categories)).map((c) => [c.name, c.id]));
  await db.insert(transactions).values(
    bookings.map((b, i) => {
      const categoryId = b.category ? (byName.get(b.category) ?? null) : null;
      return {
        accountId: account.id,
        importId: imp.id,
        bookingDate: b.bookingDate,
        amountCents: b.amountCents,
        counterparty: b.counterparty,
        purpose: b.purpose,
        raw: { quelle: "Mockdaten" },
        dedupeHash: `${key}:${i}:${b.bookingDate}`,
        categoryId,
        categorySource: categoryId ? ("rule" as const) : null,
        // Unclear ones land in "prüfen", exactly like a real import.
        needsReview: categoryId === null,
      };
    }),
  );
  await refreshInsights(db, now);
  return { accountName: name, inserted: bookings.length, existed: false };
}

export async function listMockAccounts(db: Db) {
  return db
    .select({ id: accounts.id, name: accounts.name, accountKey: accounts.accountKey, bookings: count(transactions.id) })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .where(like(accounts.accountKey, `${PREFIX}%`))
    .groupBy(accounts.id)
    .orderBy(accounts.name);
}

/** Only ever touches accounts marked as mock; a real account id is ignored. */
export async function removeMock(db: Db, accountId: string, now = clockNow()): Promise<string | null> {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), like(accounts.accountKey, `${PREFIX}%`)));
  if (!account) return null;
  await db.delete(transactions).where(eq(transactions.accountId, account.id));
  await db.delete(imports).where(inArray(imports.accountId, [account.id]));
  await db.delete(accounts).where(eq(accounts.id, account.id));
  await refreshInsights(db, now);
  return account.name;
}
