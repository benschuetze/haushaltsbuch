import { and, asc, desc, eq, notInArray, sql } from "drizzle-orm";
import { reapplyRules, setManualCategory } from "~/lib/categorize/apply";
import type { Db } from "~/lib/db/client";
import { categories, rules, transactions } from "~/lib/db/schema";
import { refreshInsights } from "~/lib/insights";
import { isAggregator } from "~/lib/insights/recurring";

export async function nextReview(db: Db, skip: string[]) {
  const conditions = [eq(transactions.needsReview, true)];
  if (skip.length > 0) conditions.push(notInArray(transactions.id, skip));
  const [tx] = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      counterparty: transactions.counterparty,
      purpose: transactions.purpose,
      categoryId: transactions.categoryId,
      aiConfidence: transactions.aiConfidence,
    })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(desc(transactions.bookingDate), asc(transactions.id))
    .limit(1);
  const remaining = await db.$count(transactions, eq(transactions.needsReview, true));
  return { tx: tx ?? null, remaining };
}

export type ReviewDecision = {
  counterparty: string;
  categoryName: string;
  /** False for payment services like PayPal: one rule for all their bookings would be wrong. */
  permanent: boolean;
  alsoChanged: number;
};

/**
 * The user's choice is final for this booking and, unless the counterparty is a payment service,
 * becomes a rule for every booking of that counterparty, now and in future imports.
 */
export async function decideReview(db: Db, transactionId: string, categoryId: string): Promise<ReviewDecision> {
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
  const [category] = await db.select().from(categories).where(eq(categories.id, categoryId));
  if (!tx || !category) throw new Error("Buchung oder Kategorie nicht gefunden");
  await setManualCategory(db, tx.id, category.id);

  let alsoChanged = 0;
  const permanent = !isAggregator(tx.counterparty) && tx.counterparty.trim() !== "";
  if (permanent) {
    const [existing] = await db
      .select()
      .from(rules)
      .where(
        and(
          eq(rules.field, "counterparty"),
          eq(rules.matchType, "equals"),
          sql`lower(${rules.pattern}) = lower(${tx.counterparty})`,
        ),
      );
    if (existing) {
      await db.update(rules).set({ categoryId: category.id }).where(eq(rules.id, existing.id));
    } else {
      await db.insert(rules).values({
        field: "counterparty",
        matchType: "equals",
        pattern: tx.counterparty,
        categoryId: category.id,
        createdFromTransactionId: tx.id,
        note: "Beim Prüfen festgelegt",
      });
    }
    alsoChanged = await reapplyRules(db);
  }
  await refreshInsights(db);
  return { counterparty: tx.counterparty, categoryName: category.name, permanent, alsoChanged };
}
