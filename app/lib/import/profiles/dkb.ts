import { parseGermanAmount, parseGermanDate } from "~/lib/money";
import type { BankProfile } from "../types";
import { looksLike, parseTable, SkipRow } from "./shared";

/**
 * DKB export since 2023: quoted, UTF-8, short preamble. Payer and payee are separate columns;
 * which one is the other party depends on the direction of the booking.
 */
const spec = {
  label: "DKB",
  delimiter: ";",
  requiredColumns: ["Buchungsdatum", "Status", "Zahlungspflichtige*r", "Zahlungsempfänger*in", "Betrag (€)"],
  mapRow: (col: (name: string) => string) => {
    if (/vorgemerkt/i.test(col("Status"))) {
      throw new SkipRow("vorgemerkt, noch nicht gebucht – kommt mit dem nächsten Export");
    }
    const amountCents = parseGermanAmount(col("Betrag (€)"));
    return {
      bookingDate: parseGermanDate(col("Buchungsdatum")),
      amountCents,
      currency: "EUR",
      counterparty: amountCents < 0 ? col("Zahlungsempfänger*in") : col("Zahlungspflichtige*r"),
      purpose: col("Verwendungszweck"),
    };
  },
};

export const dkbProfile: BankProfile = {
  id: "dkb",
  label: "DKB",
  matches: (bytes) => looksLike(bytes, spec),
  parse: (bytes) => parseTable(bytes, spec),
};
