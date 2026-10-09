import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { categorizeTransactions } from "~/lib/categorize/apply";
import type { Db } from "~/lib/db/client";
import { accounts, imports, transactions } from "~/lib/db/schema";
import { withDedupeHashes } from "./dedupe";
import { getBankProfile } from "./profiles";
import type { RejectedRow } from "./types";

export type ImportResult = {
  total: number;
  inserted: number;
  duplicates: number;
  rejected: RejectedRow[];
  byRule: number;
  byAi: number;
  needsReview: number;
};

const INSERT_CHUNK = 500;

/** Invariant the tests hold us to: total = inserted + duplicates + rejected. No row disappears without a reason. */
export async function importCsv(
  db: Db,
  input: { accountId: string; filename: string; bytes: Uint8Array; model: LanguageModel | null },
): Promise<ImportResult> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!account) throw new Error("Konto nicht gefunden");

  const { rows, rejected } = getBankProfile(account.bankProfile).parse(input.bytes);
  const hashed = withDedupeHashes(account.id, rows);
  const total = rows.length + rejected.length;

  const [imp] = await db
    .insert(imports)
    .values({ accountId: account.id, filename: input.filename, rowCount: total })
    .returning({ id: imports.id });
  if (!imp) throw new Error("Import konnte nicht angelegt werden");

  const insertedIds: string[] = [];
  for (let i = 0; i < hashed.length; i += INSERT_CHUNK) {
    const chunk = hashed.slice(i, i + INSERT_CHUNK);
    const inserted = await db
      .insert(transactions)
      .values(
        chunk.map((r) => ({
          accountId: account.id,
          importId: imp.id,
          bookingDate: r.bookingDate,
          amountCents: r.amountCents,
          currency: r.currency,
          counterparty: r.counterparty,
          purpose: r.purpose,
          raw: r.raw,
          dedupeHash: r.dedupeHash,
        })),
      )
      .onConflictDoNothing({ target: transactions.dedupeHash })
      .returning({ id: transactions.id });
    insertedIds.push(...inserted.map((r) => r.id));
  }

  const stats = await categorizeTransactions(db, insertedIds, input.model);
  return {
    total,
    inserted: insertedIds.length,
    duplicates: hashed.length - insertedIds.length,
    rejected,
    ...stats,
  };
}
