import { parseGermanAmount, parseGermanDate } from "~/lib/money";
import type { BankProfile } from "../types";
import { looksLike, parseTable, SkipRow } from "./shared";

/** Sparkasse "CSV-CAMT V2": all fields quoted, Windows-1252, two-digit years, newest first. */
const spec = {
  label: "Sparkasse",
  delimiter: ";",
  requiredColumns: ["Auftragskonto", "Buchungstag", "Beguenstigter/Zahlungspflichtiger", "Betrag", "Info"],
  mapRow: (col: (name: string) => string) => {
    if (/vorgemerkt/i.test(col("Info"))) {
      throw new SkipRow("vorgemerkt, noch nicht gebucht – kommt mit dem nächsten Export");
    }
    return {
      bookingDate: parseGermanDate(col("Buchungstag")),
      amountCents: parseGermanAmount(col("Betrag")),
      currency: col("Waehrung") || "EUR",
      counterparty: col("Beguenstigter/Zahlungspflichtiger"),
      // Some bookings (fees, interest) have no purpose; the booking text is the best description then.
      purpose: col("Verwendungszweck") || col("Buchungstext"),
    };
  },
};

export const sparkasseProfile: BankProfile = {
  id: "sparkasse",
  label: "Sparkasse (CSV-CAMT V2)",
  matches: (bytes) => looksLike(bytes, spec),
  parse: (bytes) => parseTable(bytes, spec),
};
