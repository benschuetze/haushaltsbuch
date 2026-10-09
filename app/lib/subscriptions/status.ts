import { type Booking, DAYS, merchantKey, merchantOf, type Recurring } from "~/lib/insights/recurring";

export type Cancellation = { merchantKey: string; merchant: string; cancelledOn: string };

export type CancellationStatus =
  | { state: "pending"; expectedBy: string }
  | { state: "confirmed"; yearlyCents: number | null }
  | { state: "failed"; chargedOn: string; amountCents: number };

/** A charge already on its way when the user cancelled is not a failed cancellation. */
const GRACE_DAYS = 3;
/** Bookings arrive a few days late; only after this much past the due date does silence count. */
const SLACK_DAYS = 7;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The browser cannot read another site's answer, so the bank account is the judge: a charge after the
 * cancellation means it did not work; the next due date passing without one means it did.
 */
export function cancellationStatus(
  c: Cancellation,
  bookings: Pick<Booking, "bookingDate" | "amountCents" | "counterparty" | "purpose">[],
  recurring: Recurring[],
  today: string,
): CancellationStatus {
  const after = addDays(c.cancelledOn, GRACE_DAYS);
  const later = bookings
    .filter((b) => b.amountCents < 0 && b.bookingDate > after && merchantKey(merchantOf(b)) === c.merchantKey)
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate))[0];
  if (later) return { state: "failed", chargedOn: later.bookingDate, amountCents: later.amountCents };

  const r = recurring.find((x) => merchantKey(x.merchant) === c.merchantKey);
  const due = r ? addDays(r.lastDate, DAYS[r.cadence]) : addDays(c.cancelledOn, DAYS.monthly);
  const expectedBy = addDays(due > c.cancelledOn ? due : c.cancelledOn, SLACK_DAYS);
  if (today > expectedBy) return { state: "confirmed", yearlyCents: r?.yearlyCents ?? null };
  return { state: "pending", expectedBy };
}
