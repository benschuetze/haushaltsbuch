import { parseGermanAmount, parseGermanDate } from "~/lib/money";
import type { BankProfile } from "../types";
import { looksLike, parseTable } from "./shared";

/** Volksbanken und Raiffeisenbanken (VR-Banking export): unquoted, UTF-8 with BOM, own account in every row. */
const spec = {
  label: "Volksbank / Raiffeisenbank",
  delimiter: ";",
  requiredColumns: ["IBAN Auftragskonto", "Buchungstag", "Name Zahlungsbeteiligter", "Verwendungszweck", "Betrag"],
  mapRow: (col: (name: string) => string) => ({
    bookingDate: parseGermanDate(col("Buchungstag")),
    amountCents: parseGermanAmount(col("Betrag")),
    currency: col("Waehrung") || "EUR",
    counterparty: col("Name Zahlungsbeteiligter"),
    purpose: col("Verwendungszweck") || col("Buchungstext"),
  }),
};

export const volksbankProfile: BankProfile = {
  id: "volksbank",
  label: "Volksbank / Raiffeisenbank",
  matches: (bytes) => looksLike(bytes, spec),
  parse: (bytes) => parseTable(bytes, spec),
};
