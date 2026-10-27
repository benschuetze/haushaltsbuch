import { and, eq, gt, or } from "drizzle-orm";
import { clockNow } from "~/lib/clock";
import type { Db } from "~/lib/db/client";
import { transactions } from "~/lib/db/schema";

/** How long after capturing the user can still take a booking back. */
export const UNDO_WINDOW_MINUTES = 10;

export type UndoResult = { ok: true } | { ok: false; error: string };

/**
 * Takes back a quick-capture booking. Only voice rows are ever deleted, never imported ones: those came from a bank
 * file and belong to the books. A young row can be taken back; an old one stays, because by then it may be part of a
 * month the user has looked at. The exception is a draft without amount: the app has no amount editor yet, so
 * deleting is the only way out of "prüfen" for it. One conditional delete, so a check and a delete cannot drift apart.
 */
export async function undoCapture(db: Db, id: string, now: Date = clockNow()): Promise<UndoResult> {
  const cutoff = new Date(now.getTime() - UNDO_WINDOW_MINUTES * 60_000);
  const deleted = await db
    .delete(transactions)
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.source, "voice"),
        or(gt(transactions.createdAt, cutoff), eq(transactions.amountCents, 0)),
      ),
    )
    .returning({ id: transactions.id });
  if (deleted.length > 0) return { ok: true };
  return {
    ok: false,
    error: `Rückgängig geht nur für Sprachbuchungen der letzten ${UNDO_WINDOW_MINUTES} Minuten.`,
  };
}
