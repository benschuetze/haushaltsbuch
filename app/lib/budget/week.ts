import { detectRecurring, merchantKey, merchantOf } from "~/lib/insights/recurring";
import type { AvailableBooking } from "./available";

/**
 * "How was my week?" Only spending one decides on day by day counts: no transfers, no fixed costs with a
 * stable amount (rent was decided long ago). Compared fairly: Monday until today against the same weekdays
 * of earlier weeks. Weeks without any booking are unknown (export missing), not "zero spent".
 */
export type WeekReview = {
  weekStart: string;
  today: string;
  spentCents: number;
  /** Average of up to four earlier weeks over the same weekdays; null without history. */
  usualCents: number | null;
  /** Completed weeks in a row below their own usual, most recent first. */
  streakWeeks: number;
};

const DAY = 86_400_000;

function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const t = Date.parse(date);
  const weekday = (new Date(t).getUTCDay() + 6) % 7; // Monday = 0
  return iso(t - weekday * DAY);
}

function addDays(date: string, days: number): string {
  return iso(Date.parse(date) + days * DAY);
}

export function weekReview(bookings: AvailableBooking[], today: string): WeekReview {
  const fixed = new Set(
    detectRecurring(bookings, today)
      // Weekly "regulars" (same shop, same amount) are still everyday spending; fixed means monthly or longer.
      .filter((r) => r.stable && r.cadence !== "weekly")
      .map((r) => merchantKey(r.merchant)),
  );
  const variable = bookings.filter(
    (b) => b.amountCents < 0 && b.categoryKind !== "transfer" && !fixed.has(merchantKey(merchantOf(b))),
  );
  // A week without a single everyday booking almost always means its export is missing, not a zero week.
  const anyBooking = new Set(variable.map((b) => b.bookingDate));
  const spentBetween = (from: string, to: string) =>
    variable.filter((b) => b.bookingDate >= from && b.bookingDate <= to).reduce((s, b) => s - b.amountCents, 0);
  const hasData = (from: string, to: string) => [...anyBooking].some((d) => d >= from && d <= to);

  const weekStart = mondayOf(today);
  const daysIn = Math.round((Date.parse(today) - Date.parse(weekStart)) / DAY);

  /** Usual spending for a window starting `offset` days after a Monday, over the 4 weeks before `monday`. */
  const usualBefore = (monday: string, span: number): number | null => {
    const samples: number[] = [];
    for (let w = 1; w <= 4; w++) {
      const from = addDays(monday, -7 * w);
      const to = addDays(from, span);
      if (hasData(from, addDays(from, 6))) samples.push(spentBetween(from, to));
    }
    return samples.length >= 2 ? Math.round(samples.reduce((s, x) => s + x, 0) / samples.length) : null;
  };

  let streakWeeks = 0;
  for (let w = 1; w <= 26; w++) {
    const monday = addDays(weekStart, -7 * w);
    const usual = usualBefore(monday, 6);
    if (usual === null || !hasData(monday, addDays(monday, 6))) break;
    if (spentBetween(monday, addDays(monday, 6)) >= usual) break;
    streakWeeks++;
  }

  return {
    weekStart,
    today,
    spentCents: spentBetween(weekStart, today),
    usualCents: usualBefore(weekStart, daysIn),
    streakWeeks,
  };
}
