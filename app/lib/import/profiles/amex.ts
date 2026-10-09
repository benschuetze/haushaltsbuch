import { parseGermanAmount, parseGermanDate } from "~/lib/money";
import type { BankProfile } from "../types";
import { looksLike, parseTable } from "./shared";

/** Counterparty given to the monthly settlement from the bank account. */
export const AMEX_PAYMENT = "American Express (Kartenausgleich)";
const PAYMENT = /zahlung erhalten|lastschrift erhalten|ihre zahlung/i;

/**
 * American Express Germany, "Umsätze herunterladen" as CSV. Charges are positive and payments negative,
 * the opposite of a bank statement, so the sign is flipped; read as is, every purchase would be income.
 * Dates use slashes (dd/mm/yyyy).
 */
const spec = {
  label: "American Express",
  delimiter: ",",
  requiredColumns: ["Datum", "Beschreibung", "Karteninhaber", "Betrag"],
  mapRow: (col: (name: string) => string) => {
    const description = col("Beschreibung");
    const payment = PAYMENT.test(description);
    return {
      bookingDate: parseGermanDate(col("Datum").replaceAll("/", ".")),
      amountCents: -parseGermanAmount(col("Betrag")),
      currency: "EUR",
      counterparty: payment ? AMEX_PAYMENT : description,
      purpose: payment ? description : "Kreditkarte",
    };
  },
};

export const amexProfile: BankProfile = {
  id: "amex",
  label: "American Express",
  matches: (bytes) => looksLike(bytes, spec),
  parse: (bytes) => parseTable(bytes, spec),
};
