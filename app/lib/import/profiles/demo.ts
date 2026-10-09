import { parseGermanAmount, parseGermanDate } from "~/lib/money";
import type { BankProfile } from "../types";
import { looksLike, parseTable } from "./shared";

const spec = {
  label: "Standard",
  delimiter: ";",
  requiredColumns: ["Buchungstag", "Wertstellung", "Empfänger/Auftraggeber", "Verwendungszweck", "Betrag", "Währung"],
  mapRow: (col: (name: string) => string) => ({
    bookingDate: parseGermanDate(col("Buchungstag")),
    amountCents: parseGermanAmount(col("Betrag")),
    currency: col("Währung") || "EUR",
    counterparty: col("Empfänger/Auftraggeber"),
    purpose: col("Verwendungszweck"),
  }),
};

/** Format of beispieldaten/demo-umsaetze.csv: one header line, semicolon, German dates and amounts. */
export const demoProfile: BankProfile = {
  id: "demo",
  label: "Standard (Demo-Format)",
  matches: (bytes) => looksLike(bytes, spec),
  parse: (bytes) => parseTable(bytes, spec),
};
