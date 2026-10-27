import { and, asc, count, desc, eq, gte, isNull, lt, sql, sum } from "drizzle-orm";
import { clockNow } from "~/lib/clock";
import type { Db } from "~/lib/db/client";
import { accounts, categories, rules, transactions } from "~/lib/db/schema";

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function currentMonth(now = clockNow()): string {
  return now.toISOString().slice(0, 7);
}

export async function listCategories(db: Db) {
  return db.select().from(categories).orderBy(asc(categories.sortOrder));
}

export async function listAccounts(db: Db) {
  return db.select().from(accounts).orderBy(asc(accounts.name));
}

export async function monthsWithData(db: Db): Promise<string[]> {
  const rows = await db
    .selectDistinct({ month: sql<string>`to_char(${transactions.bookingDate}, 'YYYY-MM')` })
    .from(transactions)
    .orderBy(desc(sql`1`));
  return rows.map((r) => r.month);
}

export type CategoryTotal = {
  categoryId: string | null;
  name: string;
  color: string;
  kind: "expense" | "income" | "transfer" | null;
  cents: number;
  count: number;
};

export type MonthSummary = {
  month: string;
  incomeCents: number;
  expenseCents: number;
  transferCents: number;
  /** Transfers cancel out in the balance; count and moved volume say what happened. */
  transferCount: number;
  transferVolumeCents: number;
  byCategory: CategoryTotal[];
  reviewCount: number;
  transactionCount: number;
};

/** Transfers between own accounts are neither income nor spending, so they are reported separately. */
/** `untilDay`: only the 1st to that day, for comparing a running month with the same days of the one before. */
export async function monthSummary(db: Db, month: string, untilDay?: number): Promise<MonthSummary> {
  const range = monthRange(month);
  const from = range.from;
  // On the 31st the shorter month before is compared in full, never as an impossible "31 September".
  const [y, m] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const to = untilDay && untilDay < daysInMonth ? `${month}-${String(untilDay + 1).padStart(2, "0")}` : range.to;
  const inMonth = and(gte(transactions.bookingDate, from), lt(transactions.bookingDate, to));

  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      name: categories.name,
      color: categories.color,
      kind: categories.kind,
      positive: sql<string>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.amountCents} > 0), 0)`,
      negative: sql<string>`coalesce(sum(${transactions.amountCents}) filter (where ${transactions.amountCents} < 0), 0)`,
      total: sum(transactions.amountCents),
      count: count(),
      review: sql<string>`count(*) filter (where ${transactions.needsReview})`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(inMonth)
    .groupBy(transactions.categoryId, categories.name, categories.color, categories.kind, categories.sortOrder)
    .orderBy(asc(categories.sortOrder));

  let incomeCents = 0;
  let expenseCents = 0;
  let transferCents = 0;
  let transferCount = 0;
  let transferVolumeCents = 0;
  let reviewCount = 0;
  let transactionCount = 0;
  for (const r of rows) {
    reviewCount += Number(r.review);
    transactionCount += r.count;
    if (r.kind === "transfer") {
      transferCents += Number(r.total ?? 0);
      transferCount += r.count;
      transferVolumeCents -= Number(r.negative);
    } else {
      incomeCents += Number(r.positive);
      expenseCents += Number(r.negative);
    }
  }

  return {
    month,
    incomeCents,
    expenseCents,
    transferCents,
    transferCount,
    transferVolumeCents,
    reviewCount,
    transactionCount,
    byCategory: rows.map((r) => ({
      categoryId: r.categoryId,
      name: r.name ?? "Ohne Kategorie",
      color: r.color ?? "#9a9a9a",
      kind: r.kind,
      cents: Number(r.total ?? 0),
      count: r.count,
    })),
  };
}

export type TransactionFilter = {
  month?: string;
  categoryId?: string | "none";
  review?: boolean;
};

function transactionConditions(filter: TransactionFilter) {
  const conditions = [];
  if (filter.month) {
    const { from, to } = monthRange(filter.month);
    conditions.push(gte(transactions.bookingDate, from), lt(transactions.bookingDate, to));
  }
  if (filter.categoryId === "none") conditions.push(isNull(transactions.categoryId));
  else if (filter.categoryId) conditions.push(eq(transactions.categoryId, filter.categoryId));
  if (filter.review) conditions.push(eq(transactions.needsReview, true));
  return and(...conditions);
}

/** Newest first. Pages of a few hundred at most: every row carries a category picker, which phones feel. */
export async function listTransactions(db: Db, filter: TransactionFilter, limit = 1000) {
  return db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      currency: transactions.currency,
      counterparty: transactions.counterparty,
      purpose: transactions.purpose,
      categoryId: transactions.categoryId,
      categorySource: transactions.categorySource,
      aiConfidence: transactions.aiConfidence,
      needsReview: transactions.needsReview,
    })
    .from(transactions)
    .where(transactionConditions(filter))
    .orderBy(desc(transactions.bookingDate), asc(transactions.counterparty), asc(transactions.id))
    .limit(Math.min(limit, 1000));
}

export async function countTransactions(db: Db, filter: TransactionFilter): Promise<number> {
  return db.$count(transactions, transactionConditions(filter));
}

export async function listRules(db: Db) {
  return db
    .select({
      id: rules.id,
      field: rules.field,
      matchType: rules.matchType,
      pattern: rules.pattern,
      priority: rules.priority,
      categoryId: rules.categoryId,
      categoryName: categories.name,
      createdAt: rules.createdAt,
    })
    .from(rules)
    .innerJoin(categories, eq(rules.categoryId, categories.id))
    .orderBy(desc(rules.priority), asc(rules.createdAt));
}
