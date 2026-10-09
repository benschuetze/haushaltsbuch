import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { bankFormats } from "~/lib/db/schema";
import { detectBankProfile, getBankProfile } from "../profiles";
import type { ParseResult } from "../types";
import { guessMapping, headerSignature, mappingWorks, parseWithMapping, readTable } from "./generic";
import { guessMappingWithLlm } from "./llm-mapping";

export type DetectedFormat = {
  /** Built-in profile id or "format:<uuid>"; stored on the account. */
  profileKey: string;
  label: string;
  result: ParseResult;
  /** Set when this upload taught the app a new format, and how. */
  learned: "heuristic" | "ai" | null;
};

const GENERIC_FILE_WORDS =
  /^(umsatz|umsaetze|umsätze|kontoumsaetze|kontoauszug|transactions?|export|csv|konto|account)$/i;

/** "n26-csv-transactions.csv" → "N26". Digits-only parts are dropped, they are usually account numbers. */
export function labelFromFilename(filename: string): string {
  const token = filename
    .replace(/\.[^.]+$/, "")
    .split(/[-_ .]+/)
    .find((t) => /[a-zäöü]/i.test(t) && !/\d{5,}/.test(t) && !GENERIC_FILE_WORDS.test(t));
  if (!token) return "Neue Bank";
  return token.length <= 3 ? token.toUpperCase() : token[0]?.toUpperCase() + token.slice(1);
}

async function learn(
  db: Db,
  signature: string,
  values: { label: string; mapping: (typeof bankFormats.$inferInsert)["mapping"]; source: "heuristic" | "ai" },
) {
  await db
    .insert(bankFormats)
    .values({ headerSignature: signature, ...values })
    .onConflictDoNothing({ target: bankFormats.headerSignature });
  const [format] = await db.select().from(bankFormats).where(eq(bankFormats.headerSignature, signature));
  if (!format) throw new Error("Format konnte nicht gespeichert werden");
  return format;
}

/**
 * Cheapest first: built-in profiles, formats learned earlier, a guess from column names, and only then one LLM call.
 * Whatever works for an unknown format is stored, so the same bank never costs a second call.
 */
export async function detectFormat(
  db: Db,
  input: { bytes: Uint8Array; filename: string; model: LanguageModel | null },
): Promise<DetectedFormat> {
  const builtin = detectBankProfile(input.bytes);
  if (builtin) {
    return { profileKey: builtin.id, label: builtin.label, result: builtin.parse(input.bytes), learned: null };
  }

  const table = readTable(input.bytes);
  if (!table) throw new Error("Die Datei sieht nicht nach einer Umsatz-Tabelle aus (keine Kopfzeile gefunden).");
  const signature = headerSignature(table);

  const [known] = await db.select().from(bankFormats).where(eq(bankFormats.headerSignature, signature));
  if (known) {
    return {
      profileKey: `format:${known.id}`,
      label: known.label,
      result: parseWithMapping(table, known.mapping),
      learned: null,
    };
  }

  const guessed = guessMapping(table);
  if (guessed && mappingWorks(table, guessed)) {
    const format = await learn(db, signature, {
      label: labelFromFilename(input.filename),
      mapping: guessed,
      source: "heuristic",
    });
    return {
      profileKey: `format:${format.id}`,
      label: format.label,
      result: parseWithMapping(table, guessed),
      learned: "heuristic",
    };
  }

  if (input.model) {
    const fromLlm = await guessMappingWithLlm(input.model, table);
    if (fromLlm && mappingWorks(table, fromLlm.mapping)) {
      const format = await learn(db, signature, { label: fromLlm.bank, mapping: fromLlm.mapping, source: "ai" });
      return {
        profileKey: `format:${format.id}`,
        label: format.label,
        result: parseWithMapping(table, fromLlm.mapping),
        learned: "ai",
      };
    }
  }

  throw new Error(
    `Das Format dieser Datei kennt die App noch nicht und konnte die Spalten nicht sicher zuordnen. Gefundene Spalten: ${table.header.join(", ")}.${
      input.model ? "" : " Ohne KI-Schlüssel werden unbekannte Formate nur an den Spaltennamen erkannt."
    }`,
  );
}

/** Parser for an account the user picked explicitly. */
export async function parseForProfile(db: Db, profileKey: string, bytes: Uint8Array): Promise<ParseResult> {
  if (!profileKey.startsWith("format:")) return getBankProfile(profileKey).parse(bytes);
  const [format] = await db
    .select()
    .from(bankFormats)
    .where(eq(bankFormats.id, profileKey.slice("format:".length)));
  const table = readTable(bytes);
  if (!format || !table || headerSignature(table) !== format.headerSignature) {
    throw new Error(`Kopfzeile passt nicht zum Format „${format?.label ?? profileKey}“.`);
  }
  return parseWithMapping(table, format.mapping);
}

export async function profileLabel(db: Db, profileKey: string): Promise<string> {
  if (!profileKey.startsWith("format:")) return getBankProfile(profileKey).label;
  const [format] = await db
    .select({ label: bankFormats.label })
    .from(bankFormats)
    .where(eq(bankFormats.id, profileKey.slice("format:".length)));
  return format?.label ?? "Unbekannte Bank";
}
