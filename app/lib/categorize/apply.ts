import type { LanguageModel } from "ai";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { takeFromDailyBudget } from "~/lib/daily-budget.server";
import type { Db } from "~/lib/db/client";
import { categories, rules, transactions } from "~/lib/db/schema";
import { linkOwnTransfers } from "~/lib/import/transfers";
import { type LlmExample, pickExamples } from "./examples";
import { knownMerchantCategory } from "./known-merchants";
import { categorizeWithLlm, PROMPT_VERSION } from "./llm";
import { firstMatchingRule } from "./rules";

type Assignment = {
  id: string;
  categoryId: string | null;
  source: "rule" | "ai" | null;
  confidence: number | null;
  needsReview: boolean;
  /** Set only for AI decisions; a rule or a reset clears them. */
  promptVersion?: string | null;
  model?: string | null;
};

/**
 * A quick-capture sentence without an amount (0 EUR, source voice) is only a note of what the user said. Whatever
 * category it gets later, the missing amount still needs the user, so no path may clear its review flag.
 */
const isVoiceDraft = sql`(${transactions.source} = 'voice' and ${transactions.amountCents} = 0)`;

/** One UPDATE for all rows. The WHERE clause guards manual categories at the database level, not just in app code. */
async function writeAssignments(db: Db, assignments: Assignment[]): Promise<void> {
  if (assignments.length === 0) return;
  const values = sql.join(
    assignments.map(
      (a) =>
        sql`(${a.id}::uuid, ${a.categoryId}::uuid, ${a.source}::category_source, ${a.confidence}::real, ${a.needsReview}::boolean, ${a.promptVersion ?? null}::text, ${a.model ?? null}::text)`,
    ),
    sql`, `,
  );
  await db.execute(sql`
    update ${transactions} as t
    set category_id = v.category_id, category_source = v.source, ai_confidence = v.confidence, needs_review = v.needs_review or (t.source = 'voice' and t.amount_cents = 0),
      ai_prompt_version = v.prompt_version, ai_model = v.model
    from (values ${values}) as v(id, category_id, source, confidence, needs_review, prompt_version, model)
    where t.id = v.id and t.category_source is distinct from 'manual'
  `);
}

/** What the household filed or confirmed by hand, newest first: the model's examples, see pickExamples. */
async function confirmedExamples(db: Db): Promise<LlmExample[]> {
  return db
    .select({
      counterparty: transactions.counterparty,
      purpose: transactions.purpose,
      amountCents: transactions.amountCents,
      category: categories.name,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(transactions.categorySource, "manual"))
    .orderBy(desc(transactions.bookingDate))
    .limit(300);
}

/** Built-in merchant list resolved to this database's category ids; a renamed or deleted category is skipped. */
function knownCategoryIds(
  all: { id: string; name: string }[],
): (tx: { counterparty: string; amountCents: number }) => string | null {
  const byName = new Map(all.map((c) => [c.name, c.id]));
  return (tx) => {
    const name = knownMerchantCategory(tx.counterparty, tx.amountCents);
    return name ? (byName.get(name) ?? null) : null;
  };
}

export type CategorizeStats = { byRule: number; byAi: number; needsReview: number };

/**
 * Bookings per day that may go to the model (40 calls of 25). A normal month is a few hundred; a 4 MB file of
 * old history could be tens of thousands and would otherwise drain the credit. The rest waits in "prüfen".
 */
export const LLM_DAILY_ITEMS = 1000;

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
  const known = knownCategoryIds(allCategories);
  for (const tx of txs) {
    // Own rules first, then the built-in merchant list; the model only sees what neither knows.
    const categoryId = firstMatchingRule(allRules, tx)?.categoryId ?? known(tx);
    if (categoryId) {
      assignments.push({ id: tx.id, categoryId, source: "rule", confidence: null, needsReview: false });
      stats.byRule++;
    } else if (tx.source === "voice" && tx.amountCents === 0) {
      // Nothing to judge without an amount, and not worth a paid call.
      assignments.push({ id: tx.id, categoryId: null, source: null, confidence: null, needsReview: true });
      stats.needsReview++;
    } else {
      forLlm.push(tx);
    }
  }

  if (forLlm.length > 0) {
    const granted = model ? await takeFromDailyBudget(db, "llm_items", forLlm.length, LLM_DAILY_ITEMS) : 0;
    const modelId = model ? (typeof model === "string" ? model : model.modelId) : null;
    const pool = model ? await confirmedExamples(db) : [];
    const verdicts = model
      ? await categorizeWithLlm(
          model,
          allCategories,
          forLlm.slice(0, granted).map((tx) => ({
            id: tx.id,
            counterparty: tx.counterparty,
            purpose: tx.purpose,
            amountCents: tx.amountCents,
            bookingDate: tx.bookingDate,
          })),
          undefined,
          undefined,
          (batch) => pickExamples(pool, batch),
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
          promptVersion: PROMPT_VERSION,
          model: modelId,
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
  const [allRules, allCategories, txs] = await Promise.all([
    db.select().from(rules),
    db.select().from(categories),
    db
      .select()
      .from(transactions)
      .where(or(isNull(transactions.categorySource), ne(transactions.categorySource, "manual"))),
  ]);
  const assignments: Assignment[] = [];
  const known = knownCategoryIds(allCategories);
  const expense = new Set(allCategories.filter((c) => c.kind === "expense").map((c) => c.id));
  for (const tx of txs) {
    // Also fixes what the model (or an older version without the merchant list) got wrong before.
    const categoryId = firstMatchingRule(allRules, tx)?.categoryId ?? known(tx);
    if (categoryId && (tx.categoryId !== categoryId || tx.categorySource !== "rule" || tx.needsReview)) {
      assignments.push({ id: tx.id, categoryId, source: "rule", confidence: null, needsReview: false });
    } else if (
      !categoryId &&
      tx.categorySource === "rule" &&
      tx.amountCents >= 0 &&
      tx.categoryId &&
      expense.has(tx.categoryId)
    ) {
      // Money coming in, filed as an expense by a rule that no longer matches (an older merchant list took the
      // pension for insurance): not a guess to keep, a question for the user.
      assignments.push({ id: tx.id, categoryId: null, source: null, confidence: null, needsReview: true });
    }
  }
  await writeAssignments(db, assignments);
  // A broad rule ("paypal" -> Shopping) must not turn PayPal transfers back into spending.
  await linkOwnTransfers(db);
  return assignments.length;
}

export async function setManualCategory(db: Db, transactionId: string, categoryId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ categoryId, categorySource: "manual", needsReview: isVoiceDraft })
    .where(eq(transactions.id, transactionId));
}

/** Confirming keeps the suggested category and makes it the user's decision, so nothing overwrites it later. */
export async function confirmTransaction(db: Db, transactionId: string): Promise<void> {
  await db
    .update(transactions)
    .set({ categorySource: "manual", needsReview: false })
    .where(and(eq(transactions.id, transactionId), sql`${transactions.categoryId} is not null`));
}
