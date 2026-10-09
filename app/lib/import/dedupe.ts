import { createHash } from "node:crypto";
import type { NormalizedRow } from "./types";

/**
 * Two identical card payments on the same day are real and must both survive. Each repeat within a file
 * gets an occurrence number, so re-importing the same file yields the same hashes and nothing twice.
 */
export function withDedupeHashes<T extends NormalizedRow>(
  accountId: string,
  rows: T[],
): (T & { dedupeHash: string })[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = [accountId, row.bookingDate, row.amountCents, row.counterparty, row.purpose].join("\u001f");
    const occurrence = (seen.get(key) ?? 0) + 1;
    seen.set(key, occurrence);
    const dedupeHash = createHash("sha256").update(`${key}\u001f${occurrence}`).digest("hex");
    return { ...row, dedupeHash };
  });
}
