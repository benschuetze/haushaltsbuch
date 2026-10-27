import { and, count, eq, gte, isNull, or, sql } from "drizzle-orm";
import { clockNow } from "~/lib/clock";
import type { Db } from "~/lib/db/client";
import { transactions } from "~/lib/db/schema";

/**
 * Alarm when too many recent bookings that were left to the model wait in „prüfen“. The typical cause is not hard
 * bookings but a broken model: an expired key, a retired model ID or a changed output format. Each of those
 * quietly sends every booking to review instead of failing loudly.
 *
 * Only bookings the model was responsible for count (no rule matched, nobody decided by hand). Measured over all
 * bookings, a total model failure on the demo data shows up as just 30 %, because rules and the merchant list
 * catch the rest; that would be indistinguishable from a normal month. Among the model's bookings a failure
 * means close to 100 %, while a healthy model leaves only the unsure ones open (eval: about 99 % hit rate).
 * 50 % sits clearly between the two. At least 10 such bookings, so one quiet week does not raise an alarm.
 */
export const REVIEW_ALARM = { share: 0.5, minBookings: 10, days: 7 } as const;

export type ReviewShare = { total: number; open: number; share: number; alarm: boolean };

export async function reviewShare(db: Db, now = clockNow()): Promise<ReviewShare> {
  const since = new Date(now.getTime() - REVIEW_ALARM.days * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({
      total: count(),
      open: sql<number>`count(*) filter (where ${transactions.needsReview})`.mapWith(Number),
    })
    .from(transactions)
    .where(
      and(
        gte(transactions.createdAt, since),
        or(isNull(transactions.categorySource), eq(transactions.categorySource, "ai")),
      ),
    );
  const total = row?.total ?? 0;
  const open = row?.open ?? 0;
  const share = total === 0 ? 0 : open / total;
  return { total, open, share, alarm: total >= REVIEW_ALARM.minBookings && share > REVIEW_ALARM.share };
}
