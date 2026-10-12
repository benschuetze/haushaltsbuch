import type { LanguageModel } from "ai";
import { and, eq, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { categorizeTransactions } from "~/lib/categorize/apply";
import type { Db } from "~/lib/db/client";
import { type Account, accounts, imports, transactions } from "~/lib/db/schema";
import { refreshInsights } from "~/lib/insights";
import { resolveAccount } from "./accounts";
import { withDedupeHashes } from "./dedupe";
import { detectFormat, parseForProfile, profileLabel } from "./formats/detect";
import { detectBankProfile } from "./profiles";
import { linkOwnTransfers } from "./transfers";
import type { ParseResult, RejectedRow } from "./types";

export type ImportResult = {
  total: number;
  inserted: number;
  duplicates: number;
  rejected: RejectedRow[];
  skipped: RejectedRow[];
  byRule: number;
  byAi: number;
  needsReview: number;
};

export type AutoImportResult = ImportResult & {
  account: { id: string; name: string; created: boolean };
  format: { label: string; learned: "heuristic" | "ai" | null };
};

const INSERT_CHUNK = 500;
/** An import still "running" after this long was cut off; a live one is done in seconds. */
const ABANDONED_AFTER_MS = 15 * 60 * 1000;

/**
 * Bookings left behind by an import that broke off after writing them but before categorising them. A retry with
 * the same file skips them as duplicates, so without this they would sit there with neither a category nor a
 * review flag. Rules and the model get a second go; without a model they go to "prüfen".
 */
async function pickUpInterrupted(db: Db, model: LanguageModel | null): Promise<void> {
  const cutOff = new Date(Date.now() - ABANDONED_AFTER_MS);
  const broken = await db
    .select({ id: imports.id })
    .from(imports)
    .where(or(eq(imports.status, "failed"), and(eq(imports.status, "running"), lt(imports.importedAt, cutOff))));
  if (broken.length === 0) return;
  const left = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        inArray(
          transactions.importId,
          broken.map((b) => b.id),
        ),
        isNull(transactions.categoryId),
        eq(transactions.needsReview, false),
        or(isNull(transactions.categorySource), ne(transactions.categorySource, "manual")),
      ),
    );
  if (left.length > 0)
    await categorizeTransactions(
      db,
      left.map((t) => t.id),
      model,
    );
}

/** Invariant the tests hold us to: total = inserted + duplicates + rejected + skipped. No row disappears without a reason. */
export async function storeParsed(
  db: Db,
  account: Account,
  parsed: ParseResult,
  input: { filename: string; model: LanguageModel | null },
): Promise<ImportResult> {
  const { rows, rejected, skipped } = parsed;
  const hashed = withDedupeHashes(account.id, rows);
  const total = rows.length + rejected.length + skipped.length;

  await pickUpInterrupted(db, input.model);

  const [imp] = await db
    .insert(imports)
    .values({ accountId: account.id, filename: input.filename, rowCount: total, status: "running" })
    .returning({ id: imports.id });
  if (!imp) throw new Error("Import konnte nicht angelegt werden");

  // No transaction around this (neon-http has none): every step is safe to repeat, see pickUpInterrupted.
  try {
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

    // PayPal top-ups and their bank debits are transfers; filing them first also keeps them away from the LLM.
    const transfers = new Set(await linkOwnTransfers(db));
    const stats = await categorizeTransactions(
      db,
      insertedIds.filter((id) => !transfers.has(id)),
      input.model,
    );
    if (insertedIds.length > 0) await refreshInsights(db);
    await db.update(imports).set({ status: "done" }).where(eq(imports.id, imp.id));
    return {
      total,
      inserted: insertedIds.length,
      duplicates: hashed.length - insertedIds.length,
      rejected,
      skipped,
      ...stats,
    };
  } catch (error) {
    await db.update(imports).set({ status: "failed" }).where(eq(imports.id, imp.id));
    throw error;
  }
}

/** Import into an account the user picked. */
export async function importCsv(
  db: Db,
  input: { accountId: string; filename: string; bytes: Uint8Array; model: LanguageModel | null },
): Promise<ImportResult> {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
  if (!account) throw new Error("Konto nicht gefunden");

  let parsed: ParseResult;
  try {
    parsed = await parseForProfile(db, account.bankProfile, input.bytes);
  } catch (error) {
    const other = detectBankProfile(input.bytes);
    if (other && other.id !== account.bankProfile) {
      const label = await profileLabel(db, account.bankProfile);
      throw new Error(
        `Die Datei sieht nach ${other.label} aus, das Konto „${account.name}“ ist aber auf ${label} eingestellt. Lade sie ohne Kontoauswahl hoch, dann ordnet die App sie selbst zu.`,
      );
    }
    throw error;
  }
  return storeParsed(db, account, parsed, input);
}

/** Import without choosing anything: the app finds the bank format and the account, creating either if needed. */
export async function importAuto(
  db: Db,
  input: { filename: string; bytes: Uint8Array; model: LanguageModel | null },
): Promise<AutoImportResult> {
  const format = await detectFormat(db, input);
  const { account, created } = await resolveAccount(db, {
    profileKey: format.profileKey,
    label: format.label,
    ownIban: format.result.ownIban,
  });
  const result = await storeParsed(db, account, format.result, input);
  return {
    ...result,
    account: { id: account.id, name: account.name, created },
    format: { label: format.label, learned: format.learned },
  };
}
