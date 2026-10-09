import { and, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { accounts, categories, transactions } from "~/lib/db/schema";

/** Counterparty the PayPal profile gives to top-ups from the bank account. */
export const PAYPAL_TOP_UP = "PayPal (vom Bankkonto)";
const PAYPAL_ON_BANK = /paypal/i;
const MAX_DAYS = 5;

function days(a: string, b: string) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/**
 * A purchase paid with PayPal shows up twice: as "Thomann −89 €" in the PayPal export and as
 * "PayPal Europe −89 €" on the bank account. The purchase is the spending; the bank debit and the PayPal
 * top-up are money moving between own accounts. Both are filed as "Umbuchung" so nothing counts twice.
 * Top-ups always are transfers; a bank debit only once its PayPal counterpart is there (same amount,
 * at most five days apart), since without a PayPal export it is the only trace of the purchase.
 * Manual choices are left alone. Safe to run again: returns the ids it filed.
 */
export async function linkPayPalTransfers(db: Db): Promise<string[]> {
  const [transfer] = await db.select().from(categories).where(eq(categories.name, "Umbuchung"));
  if (!transfer) return [];
  const notManual = or(isNull(transactions.categorySource), ne(transactions.categorySource, "manual"));
  const rows = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      counterparty: transactions.counterparty,
      profile: accounts.bankProfile,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(and(notManual, ilike(transactions.counterparty, "%paypal%")));

  const topUps = rows.filter((r) => r.profile === "paypal" && r.counterparty === PAYPAL_TOP_UP && r.amountCents > 0);
  const debits = rows.filter((r) => r.profile !== "paypal" && r.amountCents < 0 && PAYPAL_ON_BANK.test(r.counterparty));

  const linked = new Set(topUps.map((t) => t.id));
  const used = new Set<string>();
  for (const top of topUps) {
    const match = debits
      .filter(
        (d) =>
          !used.has(d.id) && d.amountCents === -top.amountCents && days(d.bookingDate, top.bookingDate) <= MAX_DAYS,
      )
      .sort((a, b) => days(a.bookingDate, top.bookingDate) - days(b.bookingDate, top.bookingDate))[0];
    if (match) {
      used.add(match.id);
      linked.add(match.id);
    }
  }

  const ids = [...linked];
  if (ids.length > 0) {
    await db
      .update(transactions)
      .set({ categoryId: transfer.id, categorySource: "rule", aiConfidence: null, needsReview: false })
      .where(and(inArray(transactions.id, ids), notManual));
  }
  return ids;
}
