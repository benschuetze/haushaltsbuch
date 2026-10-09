import type { LanguageModel } from "ai";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { categories, rules, transactions } from "~/lib/db/schema";
import { linkPayPalTransfers } from "~/lib/import/transfers";
import { categorizeWithLlm } from "./llm";
import { firstMatchingRule } from "./rules";

type Assignment = {
  id: string;
  categoryId: string | null;
  source: "rule" | "ai" | null;
  confidence: number | null;
  needsReview: boolean;
};

/** One UPDATE for all rows. The WHERE clause guards manual categories at the database level, not just in app code. */
async function writeAssignments(db: Db, assignments: Assignment[]): Promise<void> {
  if (assignments.length === 0) return;
  const values = sql.join(
    assignments.map(
      (a) =>
        sql`(${a.id}::uuid, ${a.categoryId}::uuid, ${a.source}::category_source, ${a.confidence}::real, ${a.needsReview}::boolean)`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    update ${transactions} as t
    set category_id = v.category_id, category_source = v.source, ai_confidence = v.confidence, needs_review = v.needs_review
    from (values ${values}) as v(id, category_id, source, confidence, needs_review)
    where t.id = v.id and t.category_source is distinct from 'manual'
  `);
}

export type CategorizeStats = { byRule: number; byAi: number; needsReview: number };

/** Rules first, then the model for whatever is left. Without a model the rest goes to review instead of a guess. */
export async function categorizeTransactions(
  db: Db,
  transactionIds: string[],
  model: LanguageModel | null,
): Promise<CategorizeStats> {
  const stats: CategorizeStats = { byRule: 0, byAi: 0, needsReview: 0 };
  if (transactionIds.length === 0) return stats;

  const [allRules, allCategories, txs] = await Promise.all([
    db.select().from(rules),
    db.select().from(categories),
    db
      .select()
      .from(transactions)
      .where(
        and(
          inArray(transactions.id, transactionIds),
          or(isNull(transactions.categorySource), ne(transactions.categorySource, "manual")),
        ),
      ),
  ]);

  const assignments: Assignment[] = [];
  const forLlm: typeof txs = [];
  for (const tx of txs) {
    const rule = firstMatchingRule(allRules, tx);
    if (rule) {
      assignments.push({
        id: tx.id,
        categoryId: rule.categoryId,
        source: "rule",
        confidence: null,
        needsReview: false,
      });
      stats.byRule++;
    } else {
      forLlm.push(tx);
    }
  }

  if (forLlm.length > 0) {
    const verdicts = model
      ? await categorizeWithLlm(
          model,
          allCategories,
          forLlm.map((tx) => ({
            id: tx.id,
            counterparty: tx.counterparty,
            purpose: tx.purpose,
            amountCents: tx.amountCents,
            bookingDate: tx.bookingDate,
          })),
        )
      : new Map();
    for (const tx of forLlm) {
      const v = verdicts.get(tx.id);
      if (v?.categoryId) {
        assignments.push({
          id: tx.id,
          categoryId: v.categoryId,
          source: "ai",
          confidence: v.confidence,
          needsReview: v.needsReview,
        });
      } else {
        assignments.push({ id: tx.id, categoryId: null, source: null, confidence: null, needsReview: true });
      }
      if (v?.categoryId && !v.needsReview) stats.byAi++;
      else stats.needsReview++;
    }
  }

  await writeAssignments(db, assignments);
  return stats;
}

/**
 * Bookings that never got a category, e.g. because the model was unreachable during the import.
 * Rules run first again, so only what they don't catch costs a model call.
 */
export async function categorizeOpen(db: Db, model: LanguageModel | null): Promise<CategorizeStats & { open: number }> {
  const open = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        isNull(transactions.categoryId),
        or(isNull(transactions.categorySource), ne(transactions.categorySource, "manual")),
      ),
    );
  const stats = await categorizeTransactions(
    db,
    open.map((t) => t.id),
    model,
  );
  return { ...stats, open: open.length };
}

/** After a rule is added or changed: re-run all rules over every non-manual transaction. Returns how many changed. */
export async function reapplyRules(db: Db): Promise<number> {
  const [allRules, txs] = await Promise.all([
    db.select().from(rules),
    db
      .select()
      .from(transactions)
      .where(or(isNull(transactions.categorySource), ne(transactions.categorySource, "manual"))),
  ]);
  const assignments: Assignment[] = [];
  for (const tx of txs) {
    const rule = firstMatchingRule(allRules, tx);
    if (rule && (tx.categoryId !== rule.categoryId || tx.categorySource !== "rule" || tx.needsReview)) {
      assignments.push({
        id: tx.id,
        categoryId: rule.categoryId,
        source: "rule",
        confidence: null,
        needsReview: false,
      });
    }
  }
  await writeAssignments(db, assignments);
  // A broad rule ("paypal" -> Shopping) must not turn PayPal transfers back into spending.
  await linkPayPalTransfers(db);
  return assignments.length;
}

export async function setManualCategory(db: Db, transactionId: string, categoryId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ categoryId, categorySource: "manual", needsReview: false })
    .where(eq(transactions.id, transactionId));
}

/** Confirming keeps the suggested category and makes it the user's decision, so nothing overwrites it later. */
export async function confirmTransaction(db: Db, transactionId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ categorySource: "manual", needsReview: false })
    .where(and(eq(transactions.id, transactionId), sql`${transactions.categoryId} is not null`));
}
