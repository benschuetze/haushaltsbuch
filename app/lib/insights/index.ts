import { and, asc, desc, eq, isNull, lte, notInArray, sql } from "drizzle-orm";
import { availableToSpend } from "~/lib/budget/available";
import type { Db } from "~/lib/db/client";
import { budgets, categories, insights, meta, subscriptionCancellations, transactions } from "~/lib/db/schema";
import { currentMonth } from "~/lib/queries";
import { cancellationStatus } from "~/lib/subscriptions/status";
import { computeInsights } from "./compute";
import { detectRecurring, merchantKey } from "./recurring";

async function loadBookings(db: Db) {
  return db
    .select({
      bookingDate: transactions.bookingDate,
      amountCents: transactions.amountCents,
      counterparty: transactions.counterparty,
      purpose: transactions.purpose,
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      categoryKind: categories.kind,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id));
}

type Bookings = Awaited<ReturnType<typeof loadBookings>>;

/** Same rule as the overview: this month if it has bookings, otherwise the latest month with data. */
export function referenceMonth(
  bookings: Bookings,
  now = new Date(),
): { month: string; dayOfMonth: number | null; daysInMonth: number } {
  const current = currentMonth(now);
  const latest = bookings.reduce((max, b) => (b.bookingDate > max ? b.bookingDate : max), "").slice(0, 7);
  const month = bookings.some((b) => b.bookingDate.startsWith(current)) || !latest ? current : latest;
  const [y, m] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { month, dayOfMonth: month === current ? now.getUTCDate() : null, daysInMonth };
}

async function loadBudgets(db: Db) {
  return db
    .select({ categoryId: budgets.categoryId, categoryName: categories.name, amountCents: budgets.amountCents })
    .from(budgets)
    .innerJoin(categories, eq(budgets.categoryId, categories.id))
    .orderBy(asc(categories.sortOrder));
}

/**
 * Recomputes all hints for the reference month. Cheap (a few queries, no model calls), so it runs after every
 * import and every correction. Hints keep their read/dismissed state; ones that no longer apply disappear.
 */
export async function refreshInsights(db: Db, now = new Date()): Promise<void> {
  const [bookings, budgetRows, cancellations] = await Promise.all([
    loadBookings(db),
    loadBudgets(db),
    db.select().from(subscriptionCancellations),
  ]);
  if (bookings.length === 0) {
    // Everything was removed (e.g. mock accounts): nothing left to hint about.
    await db.delete(insights).where(isNull(insights.dismissedAt));
    return;
  }
  const ref = referenceMonth(bookings, now);
  const drafts = computeInsights({
    bookings,
    budgets: budgetRows,
    ...ref,
    cancellations,
    today: now.toISOString().slice(0, 10),
  });

  for (const d of drafts) {
    await db
      .insert(insights)
      .values(d)
      .onConflictDoUpdate({
        target: insights.key,
        set: {
          title: d.title,
          body: d.body,
          savingsCentsPerYear: d.savingsCentsPerYear,
          kind: d.kind,
          subject: d.subject ?? null,
          // Hints keyed without a month ("abo:netflix") move along with the reference month, so they are
          // cleaned up like the rest once they stop applying.
          month: d.month,
          updatedAt: new Date(),
        },
      });
  }
  // Hints are about now: open ones from earlier months are stale (the monthly view keeps the history).
  // Dismissed ones stay, so a hint the user waved away does not come back.
  const keep = drafts.map((d) => d.key);
  await db
    .delete(insights)
    .where(
      and(
        lte(insights.month, ref.month),
        isNull(insights.dismissedAt),
        keep.length > 0 ? notInArray(insights.key, keep) : undefined,
      ),
    );
}

export async function openInsights(db: Db, limit = 20) {
  return db
    .select()
    .from(insights)
    .where(isNull(insights.dismissedAt))
    .orderBy(desc(insights.month), desc(sql`coalesce(${insights.savingsCentsPerYear}, 0)`), desc(insights.updatedAt))
    .limit(limit);
}

export async function notificationSummary(db: Db) {
  const [reviewCount, unread] = await Promise.all([
    db.$count(transactions, eq(transactions.needsReview, true)),
    db.$count(insights, and(isNull(insights.readAt), isNull(insights.dismissedAt))),
  ]);
  return { reviewCount, unreadInsights: unread };
}

export async function markInsightsRead(db: Db): Promise<void> {
  await db.update(insights).set({ readAt: new Date() }).where(isNull(insights.readAt));
}

export async function dismissInsight(db: Db, id: string): Promise<void> {
  await db.update(insights).set({ dismissedAt: new Date(), readAt: new Date() }).where(eq(insights.id, id));
}

export type BudgetStatus = {
  categoryId: string;
  categoryName: string;
  budgetCents: number;
  spentCents: number;
  projectedCents: number | null;
};

export async function budgetStatus(db: Db, now = new Date()): Promise<{ month: string; items: BudgetStatus[] }> {
  const [bookings, budgetRows] = await Promise.all([loadBookings(db), loadBudgets(db)]);
  const ref = referenceMonth(bookings, now);
  const spent = new Map<string, number>();
  for (const b of bookings) {
    if (!b.bookingDate.startsWith(ref.month) || !b.categoryId || b.categoryKind === "transfer") continue;
    spent.set(b.categoryId, (spent.get(b.categoryId) ?? 0) - b.amountCents);
  }
  return {
    month: ref.month,
    items: budgetRows.map((b) => {
      const used = Math.max(0, spent.get(b.categoryId) ?? 0);
      return {
        categoryId: b.categoryId,
        categoryName: b.categoryName,
        budgetCents: b.amountCents,
        spentCents: used,
        projectedCents: ref.dayOfMonth ? Math.round((used / ref.dayOfMonth) * ref.daysInMonth) : null,
      };
    }),
  };
}

export async function recurringPayments(db: Db, now = new Date()) {
  const bookings = await loadBookings(db);
  const reference = bookings.reduce(
    (max, b) => (b.bookingDate > max ? b.bookingDate : max),
    now.toISOString().slice(0, 10),
  );
  return detectRecurring(bookings, reference);
}

/** Recurring payments plus what the user cancelled and whether the bookings agree, from one read. */
export async function subscriptionOverview(db: Db, now = new Date()) {
  const [bookings, cancellations] = await Promise.all([
    loadBookings(db),
    db.select().from(subscriptionCancellations).orderBy(desc(subscriptionCancellations.cancelledOn)),
  ]);
  const today = now.toISOString().slice(0, 10);
  const reference = bookings.reduce((max, b) => (b.bookingDate > max ? b.bookingDate : max), today);
  const recurring = detectRecurring(bookings, reference);
  const statuses = cancellations.map((c) => ({ ...c, status: cancellationStatus(c, bookings, recurring, today) }));
  const stillCharging = new Set(statuses.filter((c) => c.status.state === "failed").map((c) => c.merchantKey));
  const cancelled = new Set(cancellations.map((c) => c.merchantKey));
  return {
    recurring: recurring.map((r) => {
      const key = merchantKey(r.merchant);
      return { ...r, key, cancelled: cancelled.has(key) && !stillCharging.has(key) };
    }),
    cancellations: statuses,
  };
}

/** Today in Germany; a UTC date would switch to tomorrow at 1 or 2 a.m. local time. */
export function todayInGermany(now = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}

/** "How much can I spend today": see availableToSpend. */
export async function spendingToday(db: Db, now = new Date()) {
  return availableToSpend(await loadBookings(db), todayInGermany(now));
}

const STALE_MS = 6 * 60 * 60 * 1000;

/** Projections change with the calendar, not only with new bookings; recompute at most every six hours on a visit. */
export async function refreshInsightsIfStale(db: Db, now = new Date()): Promise<void> {
  const [last] = await db.select().from(meta).where(eq(meta.key, "insights_refreshed_at"));
  if (last && now.getTime() - Date.parse(last.value) < STALE_MS) return;
  await refreshInsights(db, now);
  await db
    .insert(meta)
    .values({ key: "insights_refreshed_at", value: now.toISOString() })
    .onConflictDoUpdate({ target: meta.key, set: { value: now.toISOString() } });
}
