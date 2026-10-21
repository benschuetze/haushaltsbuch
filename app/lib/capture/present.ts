import { formatDate } from "~/lib/format";
import { formatCents } from "~/lib/money";
import { berlinDay, type CaptureResult, shiftDay } from "./run";

/** What the capture page shows after booking: plain strings and flags, so it serialises and renders without logic. */
export type BookingCard = {
  id: string;
  /** False when the same key was booked before and nothing new was written. */
  created: boolean;
  /** No usable amount: the row only keeps the sentence. */
  draft: boolean;
  needsReview: boolean;
  /** Without sign, because the card says "booked"; null for a draft. */
  amountLabel: string | null;
  counterparty: string;
  /** What the user said or typed, so a draft can show it back as it was. */
  sentence: string;
  categoryLabel: string | null;
  dayLabel: string;
};

function dayLabel(bookingDate: string, now: Date): string {
  const today = berlinDay(now);
  if (bookingDate === today) return "heute";
  if (bookingDate === shiftDay(today, -1)) return "gestern";
  if (bookingDate === shiftDay(today, -2)) return "vorgestern";
  return formatDate(bookingDate);
}

export function describeBooking(result: CaptureResult, now: Date = new Date()): BookingCard {
  const { transaction: tx } = result;
  return {
    id: tx.id,
    created: result.created,
    draft: result.draft,
    needsReview: tx.needsReview,
    amountLabel: result.draft ? null : formatCents(Math.abs(tx.amountCents)),
    counterparty: tx.counterparty,
    sentence: tx.captureText ?? tx.counterparty,
    categoryLabel: result.categoryName,
    dayLabel: dayLabel(tx.bookingDate, now),
  };
}
