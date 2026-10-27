import { createHash } from "node:crypto";
import type { LanguageModel } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { categorizeTransactions } from "~/lib/categorize/apply";
import { clockNow } from "~/lib/clock";
import type { Db } from "~/lib/db/client";
import { categories, type Transaction, transactions } from "~/lib/db/schema";
import { resolveAccount } from "~/lib/import/accounts";
import { log } from "~/lib/observability/log.server";
import { safeError } from "~/lib/security.server";
import { parseSpokenAmount } from "./amount";
import { fold, parseNumberWord } from "./number-words";

export const CASH_ACCOUNT = { profileKey: "cash", label: "Bar" } as const;

export const captureInputSchema = z.object({
  text: z.string().trim().min(1, "Text fehlt").max(500, "Text ist zu lang"),
  key: z.string().trim().min(1, "Schlüssel fehlt").max(100, "Schlüssel ist zu lang"),
});
export type CaptureInput = z.infer<typeof captureInputSchema>;

export type CaptureResult = {
  /** False when the same (account, key) was booked before: the first booking is returned, nothing is written. */
  created: boolean;
  transaction: Transaction;
  categoryName: string | null;
  /** No usable amount in the sentence: the row only keeps the text so nothing the user said is lost. */
  draft: boolean;
};

const COUNTERPARTY_MAX = 80;
/** The amount column is a 32-bit integer; anything above is a dictation error, not a payment. */
const MAX_CENTS = 2_147_483_647;
const MONEY_WORDS = new Set(["euro", "euros", "eur", "cent", "cents", "ct", "komma", "€", "anderthalb"]);
const DATE_WORDS = new Set(["gestern", "vorgestern"]);

/** The calendar day in Germany, because "heute" at 01:30 is not yesterday's UTC date. */
export function berlinDay(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}

export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function bookingDate(text: string, now: Date): string {
  const words: string[] = text.toLocaleLowerCase("de").match(/[a-zäöüß]+/g) ?? [];
  const today = berlinDay(now);
  if (words.includes("vorgestern")) return shiftDay(today, -2);
  if (words.includes("gestern")) return shiftDay(today, -1);
  return today;
}

function isAmountWord(token: string): boolean {
  const word = token.toLocaleLowerCase("de");
  // "7", "7,50", "7€", "7,50€", "€7": the euro sign sticks to the number in dictation.
  if (/^€?\d+(?:[.,]\d+)*€?$/.test(word) || MONEY_WORDS.has(word)) return true;
  if (/einhalb$/.test(fold(word))) return true;
  return parseNumberWord(word) !== null;
}

/** Narration around the payment that says nothing about the payee, wherever it stands in the sentence. */
const FILLER_WORDS = new Set([
  ...["ich", "hab", "habe", "hab's", "mir", "grad", "grade", "gerade", "eben", "mal", "so", "noch", "halt"],
  ...["gezahlt", "bezahlt", "gekauft", "ausgegeben"],
]);
/** Articles and prepositions: noise at the edges ("für nen Döner"), but part of a name inside ("Bäckerei am Markt"). */
const EDGE_WORDS = new Set([
  ...["für", "fürn", "nen", "n", "ein", "eine", "einen", "einem", "einer", "der", "die", "das", "den", "dem"],
  ...["im", "in", "beim", "bei", "am", "an", "zum", "zur", "mit", "vom", "von", "auf"],
]);

/**
 * The payee: the sentence minus the amount phrase, the day word, narration and edge words. A heuristic by design: the
 * parser decides the amount, this only keeps the rest readable and rule-matchable. Never empty: a sentence that is
 * all narration falls back to itself without the amount, then to the original.
 */
export function counterpartyFrom(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  const bare = (t: string) => t.replace(/^[^\p{L}\p{N}€]+|[^\p{L}\p{N}€]+$/gu, "");
  const key = (t: string) => bare(t).toLocaleLowerCase("de").replace("’", "'");
  const drop = tokens.map((t) => {
    const word = bare(t);
    return word !== "" && (isAmountWord(word) || DATE_WORDS.has(word.toLocaleLowerCase("de")));
  });
  // "sieben und fünfzig Cent": the "und" between two removed words goes with them.
  tokens.forEach((t, i) => {
    if (bare(t).toLocaleLowerCase("de") === "und" && drop[i - 1] && drop[i + 1]) drop[i] = true;
  });
  const withoutAmount = tokens.filter((_, i) => !drop[i]);
  const words = withoutAmount.filter((t) => !FILLER_WORDS.has(key(t)));
  while (words[0] && EDGE_WORDS.has(key(words[0]))) words.shift();
  while (words.length > 0 && EDGE_WORDS.has(key(words[words.length - 1] as string))) words.pop();
  const payee = words.join(" ") || withoutAmount.join(" ") || text.trim();
  return (payee.charAt(0).toLocaleUpperCase("de") + payee.slice(1)).slice(0, COUNTERPARTY_MAX).trim();
}

/** Voice rows have no CSV line to hash; the key takes its place so the unique dedupe_hash stays satisfied. */
function dedupeHashFor(accountId: string, key: string): string {
  return createHash("sha256").update(`voice\u001f${accountId}\u001f${key}`).digest("hex");
}

async function load(db: Db, id: string): Promise<{ transaction: Transaction; categoryName: string | null }> {
  const [row] = await db
    .select({ transaction: transactions, categoryName: categories.name })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(eq(transactions.id, id));
  if (!row) throw new Error("Buchung nach dem Schreiben nicht gefunden");
  return row;
}

/**
 * Books one dictated payment. It never refuses a sentence as "not understood": no amount makes a draft, a doubtful
 * amount or category goes to "prüfen". The sentence is stored either way, because it is all the user said.
 * The model is injected (null = none configured) and only asked when no rule knows the payee and there is an amount.
 */
export async function captureSpoken(
  db: Db,
  input: CaptureInput,
  options: { model: LanguageModel | null; now?: Date },
): Promise<CaptureResult> {
  const now = options.now ?? clockNow();
  const { account } = await resolveAccount(db, CASH_ACCOUNT);

  const find = async () => {
    const [hit] = await db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.accountId, account.id), eq(transactions.captureKey, input.key)));
    return hit ? await load(db, hit.id) : null;
  };
  const before = await find();
  if (before) return { created: false, draft: before.transaction.amountCents === 0, ...before };

  const spoken = parseSpokenAmount(input.text);
  const amount = spoken && spoken.cents <= MAX_CENTS ? spoken : null;
  // Payments only: income detection is out of scope, so a spoken amount is always money going out.
  const amountCents = amount ? -amount.cents : 0;
  const flagged = !amount?.certain;

  const [inserted] = await db
    .insert(transactions)
    .values({
      accountId: account.id,
      importId: null,
      bookingDate: bookingDate(input.text, now),
      amountCents,
      counterparty: counterpartyFrom(input.text),
      purpose: "",
      raw: {},
      dedupeHash: dedupeHashFor(account.id, input.key),
      // Review until proven otherwise: if anything below fails, the row is still one the user will look at.
      needsReview: true,
      source: "voice",
      captureText: input.text,
      captureKey: input.key,
    })
    .onConflictDoNothing()
    .returning({ id: transactions.id });
  if (!inserted) {
    // A parallel request with the same key won the race.
    const raced = await find();
    if (!raced) throw new Error("Buchung weder neu noch vorhanden");
    return { created: false, draft: raced.transaction.amountCents === 0, ...raced };
  }

  try {
    // Rules and the built-in merchant list first; a draft has no amount worth a paid model call.
    await categorizeTransactions(db, [inserted.id], amount ? options.model : null);
    // Categorising clears the review flag for a confident answer; a doubtful amount keeps it.
    if (flagged) await db.update(transactions).set({ needsReview: true }).where(eq(transactions.id, inserted.id));
  } catch (error) {
    // The booking is saved and flagged; the caller still gets it instead of an error to retry.
    log.error(
      { event: "capture_categorize_failed", err: safeError(error) },
      "Kategorisierung der Schnellerfassung fehlgeschlagen",
    );
  }

  return { created: true, draft: !amount, ...(await load(db, inserted.id)) };
}
