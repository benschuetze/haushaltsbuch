import { parseGermanAmount, parseGermanDate } from "~/lib/money";
import type { BankProfile } from "../types";
import { looksLike, parseTable } from "./shared";

/**
 * ING "Umsatzanzeige": a preamble with IBAN and balance, then the table. "Währung" appears twice:
 * the first belongs to the balance, the second to the amount. ING never exports pending bookings.
 */
const spec = {
  label: "ING",
  delimiter: ";",
  requiredColumns: ["Buchung", "Wertstellungsdatum", "Auftraggeber/Empfänger", "Verwendungszweck", "Betrag"],
  mapRow: (col: (name: string, occurrence?: number) => string) => ({
    bookingDate: parseGermanDate(col("Buchung")),
    amountCents: parseGermanAmount(col("Betrag")),
    currency: col("Währung", 1) || "EUR",
    counterparty: col("Auftraggeber/Empfänger"),
    purpose: col("Verwendungszweck") || col("Buchungstext"),
  }),
};

export const ingProfile: BankProfile = {
  id: "ing",
  label: "ING",
  matches: (bytes) => looksLike(bytes, spec),
  parse: (bytes) => parseTable(bytes, spec),
};
