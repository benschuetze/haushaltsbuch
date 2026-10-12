import { count, desc, eq } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { accounts, transactions } from "~/lib/db/schema";
import { profileLabel } from "~/lib/import/formats/detect";
import { parseGermanAmount } from "~/lib/money";

export type AccountOverview = {
  id: string;
  name: string;
  bank: string;
  bookings: number;
  /** Only where the bank's export carries it ("Saldo nach Buchung"); summing bookings would miss the start. */
  balance: { date: string; cents: number } | null;
};

function balanceFrom(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const entry = Object.entries(raw as Record<string, unknown>).find(
    ([key, value]) => /saldo/i.test(key) && typeof value === "string" && value.trim(),
  );
  if (!entry) return null;
  try {
    return parseGermanAmount(entry[1] as string);
  } catch {
    return null;
  }
}

export async function accountOverview(db: Db): Promise<AccountOverview[]> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      bankProfile: accounts.bankProfile,
      bookings: count(transactions.id),
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .groupBy(accounts.id)
    .orderBy(accounts.name);
  return Promise.all(
    rows.map(async (r) => {
      const [latest] = await db
        .select({ date: transactions.bookingDate, raw: transactions.raw })
        .from(transactions)
        .where(eq(transactions.accountId, r.id))
        .orderBy(desc(transactions.bookingDate))
        .limit(1);
      const cents = latest ? balanceFrom(latest.raw) : null;
      return {
        id: r.id,
        name: r.name,
        bank: await profileLabel(db, r.bankProfile),
        bookings: r.bookings,
        balance: latest && cents !== null ? { date: latest.date, cents } : null,
      };
    }),
  );
}
