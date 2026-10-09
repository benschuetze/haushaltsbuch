import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { categorizeTransactions } from "~/lib/categorize/apply";
import { refreshInsights } from "~/lib/insights";
import type { Db } from "~/lib/db/client";
import { type Account, accounts, imports, transactions } from "~/lib/db/schema";
import { resolveAccount } from "./accounts";
import { withDedupeHashes } from "./dedupe";
import { detectFormat, parseForProfile, profileLabel } from "./formats/detect";
import { detectBankProfile } from "./profiles";
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

/** Invariant the tests hold us to: total = inserted + duplicates + rejected + skipped. No row disappears without a reason. */
async function store(
  db: Db,
  account: Account,
  parsed: ParseResult,
  input: { filename: string; model: LanguageModel | null },
): Promise<ImportResult> {
  const { rows, rejected, skipped } = parsed;
  const hashed = withDedupeHashes(account.id, rows);
  const total = rows.length + rejected.length + skipped.length;

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
  if (insertedIds.length > 0) await refreshInsights(db);
  return {
    total,
    inserted: insertedIds.length,
    duplicates: hashed.length - insertedIds.length,
    rejected,
    skipped,
    ...stats,
  };
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
  return store(db, account, parsed, input);
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
  const result = await store(db, account, format.result, input);
  return {
    ...result,
    account: { id: account.id, name: account.name, created },
    format: { label: format.label, learned: format.learned },
  };
}
