import { z } from "zod";
import { parseGermanAmount, parseGermanDate } from "~/lib/money";
import { decodeCsv, parseCsv } from "../csv";
import type { BankProfile, NormalizedRow, ParseResult } from "../types";

const HEADER = ["Buchungstag", "Wertstellung", "Empfänger/Auftraggeber", "Verwendungszweck", "Betrag", "Währung"];

const rowSchema = z.object({
  Buchungstag: z.string().transform((v) => parseGermanDate(v)),
  "Empfänger/Auftraggeber": z.string().trim(),
  Verwendungszweck: z.string().trim(),
  Betrag: z.string().transform((v) => parseGermanAmount(v)),
  Währung: z
    .string()
    .trim()
    .transform((v) => v || "EUR"),
});

/** Format of beispieldaten/demo-umsaetze.csv: one header line, semicolon, German dates and amounts. */
export const demoProfile: BankProfile = {
  id: "demo",
  label: "Standard (Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung)",
  parse(bytes): ParseResult {
    const records = parseCsv(decodeCsv(bytes), ";");
    const header = records[0]?.map((h) => h.trim());
    if (!header || HEADER.some((h, i) => header[i] !== h)) {
      throw new Error(`Kopfzeile passt nicht zum Profil „Standard“. Erwartet: ${HEADER.join(";")}`);
    }

    const rows: NormalizedRow[] = [];
    const rejected: ParseResult["rejected"] = [];
    records.slice(1).forEach((fields, index) => {
      const line = index + 2;
      if (fields.every((f) => f.trim() === "")) return;
      const raw = Object.fromEntries(header.map((h, i) => [h, fields[i] ?? ""]));
      if (fields.length !== header.length) {
        rejected.push({ line, reason: `${fields.length} statt ${header.length} Spalten` });
        return;
      }
      try {
        const parsed = rowSchema.parse(raw);
        rows.push({
          line,
          bookingDate: parsed.Buchungstag,
          amountCents: parsed.Betrag,
          currency: parsed.Währung,
          counterparty: parsed["Empfänger/Auftraggeber"],
          purpose: parsed.Verwendungszweck,
          raw,
        });
      } catch (error) {
        rejected.push({ line, reason: describe(error) });
      }
    });
    return { rows, rejected };
  },
};

function describe(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((i) => i.message).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
