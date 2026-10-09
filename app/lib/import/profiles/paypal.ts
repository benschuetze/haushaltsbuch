import { parseGermanAmount, parseGermanDate } from "~/lib/money";
import { decodeCsv, parseCsv } from "../csv";
import type { BankProfile } from "../types";
import { looksLike, SkipRow, walkTable } from "./shared";

const REQUIRED = ["Datum", "Name", "Typ", "Status", "Währung", "Netto", "Transaktionscode"];
const spec = { delimiter: ",", requiredColumns: REQUIRED };

/** Money moved in from the bank account to pay for something; the purchase itself is its own row. */
export const PAYPAL_FUNDING = /bankkonto|bankgutschrift|einzahlung|aufladung/i;
const CONVERSION = /währungsumrechnung/i;
const NOT_BOOKED = /ausstehend|storniert|abgelehnt|fehlgeschlagen|zurückgenommen/i;

/**
 * PayPal "Aktivitäten herunterladen" (CSV, German). One purchase is several rows: the payment, the top-up
 * from the bank and, abroad, two currency-conversion rows. Only euro rows count; a conversion row borrows
 * the shop's name from the payment it belongs to, because it has none of its own.
 */
function parse(bytes: Uint8Array) {
  const records = parseCsv(decodeCsv(bytes), ",");
  const headerIndex = records.findIndex((r) => REQUIRED.every((c) => r.map((x) => x.trim()).includes(c)));
  if (headerIndex < 0) throw new Error(`Kopfzeile passt nicht zum Profil „PayPal“. Erwartet: ${REQUIRED.join(", ")}`);
  const header = (records[headerIndex] ?? []).map((h) => h.trim());
  const at = (name: string) => header.indexOf(name);

  const byCode = new Map<string, { name: string; item: string }>();
  for (const r of records.slice(headerIndex + 1)) {
    const name = r[at("Name")]?.trim();
    if (name)
      byCode.set(r[at("Transaktionscode")]?.trim() ?? "", { name, item: r[at("Artikelbezeichnung")]?.trim() ?? "" });
  }

  return walkTable(records, headerIndex, (col) => {
    const status = col("Status");
    if (NOT_BOOKED.test(status)) throw new SkipRow(`bei PayPal „${status}“, nicht gebucht`);
    const currency = col("Währung");
    if (currency !== "EUR") throw new SkipRow(`${currency}-Betrag; der Euro-Betrag steht in der Umrechnungszeile`);

    const type = col("Typ");
    const related = byCode.get(
      header.includes("Zugehöriger Transaktionscode") ? col("Zugehöriger Transaktionscode") : "",
    );
    const item = [col("Artikelbezeichnung"), header.includes("Betreff") ? col("Betreff") : ""]
      .filter(Boolean)
      .join(" · ");
    let counterparty = col("Name");
    let purpose = item || type;
    if (PAYPAL_FUNDING.test(type)) {
      counterparty = "PayPal (vom Bankkonto)";
      purpose = related ? `${type} für ${related.name}` : type;
    } else if (CONVERSION.test(type) && related) {
      counterparty = related.name;
      purpose = `${related.item || "Zahlung"} (umgerechnet)`;
    }
    return {
      bookingDate: parseGermanDate(col("Datum")),
      // Net is what actually moved on the PayPal balance, fees included.
      amountCents: parseGermanAmount(col("Netto")),
      currency: "EUR",
      counterparty: counterparty || type,
      purpose,
    };
  });
}

export const paypalProfile: BankProfile = {
  id: "paypal",
  label: "PayPal",
  matches: (bytes) => looksLike(bytes, spec),
  parse,
};
