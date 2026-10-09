import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { detectDecimalStyle } from "~/lib/money";
import { dataRows, type Table } from "./generic";
import { type ColumnMapping, columnMappingSchema } from "./mapping";

/**
 * Shape of a value without its content: "REWE Markt" → "AAAA Aaaaa", "-63,12" → "-99,99".
 * Enough to tell a date from an amount from a name, nothing that identifies a person or a booking.
 */
export function maskValue(value: string): string {
  return value
    .trim()
    .slice(0, 24)
    .replace(/[A-ZÄÖÜ]/g, "A")
    .replace(/[a-zäöüß]/g, "a")
    .replace(/\d/g, "9");
}

const answerSchema = z.object({
  bank: z.string().max(60),
  date: z.number().int(),
  amount: z.number().int().nullable(),
  debit: z.number().int().nullable(),
  credit: z.number().int().nullable(),
  counterparty: z.number().int().nullable(),
  payer: z.number().int().nullable(),
  payee: z.number().int().nullable(),
  purpose: z.number().int().nullable(),
  currency: z.number().int().nullable(),
  status: z.number().int().nullable(),
});

const SYSTEM = `Du bekommst die Kopfzeile eines CSV-Kontoauszugs und maskierte Beispielzeilen
(Buchstaben als A/a, Ziffern als 9). Ordne die Spalten zu, indem du ihre Nummer (ab 0) angibst, oder null.
- date: Buchungsdatum (nicht Wertstellung/Valuta)
- amount: vorzeichenbehafteter Betrag. Bei getrennten Spalten für Soll und Haben stattdessen debit und credit.
- counterparty: Name der Gegenpartei. Gibt es getrennte Spalten für Zahler und Empfänger, nutze payer und payee.
- purpose: Verwendungszweck oder Buchungstext
- currency, status (z. B. gebucht/vorgemerkt): falls vorhanden
- bank: Name der Bank, falls an den Spaltennamen erkennbar, sonst "Unbekannte Bank".
Niemals Saldo- oder Kontostandspalten als Betrag.`;

export function buildMappingPrompt(table: Table): string {
  const header = table.header.map((h, i) => `${i}: ${h}`).join("\n");
  const samples = dataRows(table, 5)
    .map((r) => r.map(maskValue).join(" | "))
    .join("\n");
  return `Spalten:\n${header}\n\nMaskierte Beispielzeilen:\n${samples}`;
}

/** One small LLM call per unknown bank format, ever. The result is validated against the schema and the file. */
export async function guessMappingWithLlm(
  model: LanguageModel,
  table: Table,
  onError: (error: unknown) => void = (error) => console.error("Spaltenzuordnung per LLM fehlgeschlagen", error),
): Promise<{ mapping: ColumnMapping; bank: string } | null> {
  let answer: z.infer<typeof answerSchema>;
  try {
    const { output } = await generateText({
      model,
      system: SYSTEM,
      prompt: buildMappingPrompt(table),
      output: Output.object({ schema: answerSchema }),
      temperature: 0,
      maxRetries: 1,
      maxOutputTokens: 500,
    });
    answer = output;
  } catch (error) {
    onError(error);
    return null;
  }
  const { bank, ...columns } = answer;
  const inRange = Object.fromEntries(
    Object.entries(columns).filter(([, v]) => v !== null && v >= 0 && v < table.header.length),
  );
  const amountColumns = [inRange.amount, inRange.debit, inRange.credit].filter((i) => i !== undefined) as number[];
  const decimal = detectDecimalStyle(dataRows(table).flatMap((r) => amountColumns.map((i) => r[i] ?? "")));
  const parsed = columnMappingSchema.safeParse({ ...inRange, delimiter: table.delimiter, decimal: decimal ?? "de" });
  return parsed.success && decimal ? { mapping: parsed.data, bank: bank.trim() || "Unbekannte Bank" } : null;
}
