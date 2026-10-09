import { and, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { accounts, categories, transactions } from "~/lib/db/schema";
import { AMEX_PAYMENT } from "./profiles/amex";
import { PAYPAL_TOP_UP } from "./profiles/paypal";

/**
 * Accounts that are paid from the bank account. On their side the payment-in row (`incoming`), on the
 * bank side a debit to the provider (`onBank`). PayPal settles each purchase within days, a card once a
 * month a few days after the statement.
 */
const LINKS = [
  { profile: "paypal", incoming: PAYPAL_TOP_UP, onBank: "%paypal%", maxDays: 5 },
  { profile: "amex", incoming: AMEX_PAYMENT, onBank: "%american express%", maxDays: 10 },
  { profile: "amex", incoming: AMEX_PAYMENT, onBank: "%amex%", maxDays: 10 },
] as const;

function days(a: string, b: string) {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
}

/**
 * A purchase paid with PayPal or a credit card shows up twice: as "Thomann −89 €" on the PayPal or card
 * statement and as "PayPal Europe −89 €" or "American Express −367 €" on the bank account. The purchase is
 * the spending; the bank debit and the payment-in on the other side are money moving between own accounts,
 * both filed as "Umbuchung" so nothing counts twice. The payment-in always is a transfer; a bank debit only
 * once its counterpart is there (same amount, close in time), since without the other statement it is the
 * only trace of the spending. Manual choices are left alone. Safe to run again: returns the ids it filed.
 */
export async function linkOwnTransfers(db: Db): Promise<string[]> {
  const [transfer] = await db.select().from(categories).where(eq(categories.name, "Umbuchung"));
  if (!transfer) return [];
  const notManual = or(isNull(transactions.categorySource), ne(transactions.categorySource, "manual"));
  const linked = new Set<string>();
  const used = new Set<string>();
  const settled = new Set<string>();

  for (const link of LINKS) {
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
      .where(
        and(notManual, or(eq(transactions.counterparty, link.incoming), ilike(transactions.counterparty, link.onBank))),
      );
    const incoming = rows.filter(
      (r) => r.profile === link.profile && r.counterparty === link.incoming && r.amountCents > 0,
    );
    const debits = rows.filter(
      (r) => r.profile !== link.profile && r.amountCents < 0 && r.counterparty !== link.incoming,
    );

    for (const inc of incoming) {
      linked.add(inc.id);
      if (settled.has(inc.id)) continue;
      const match = debits
        .filter(
          (d) =>
            !used.has(d.id) &&
            d.amountCents === -inc.amountCents &&
            days(d.bookingDate, inc.bookingDate) <= link.maxDays,
        )
        .sort((a, b) => days(a.bookingDate, inc.bookingDate) - days(b.bookingDate, inc.bookingDate))[0];
      if (match) {
        used.add(match.id);
        settled.add(inc.id);
        linked.add(match.id);
      }
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
