// Amounts are integer cents end to end. Parsing goes through strings so no float ever touches a balance.

const GERMAN_AMOUNT = /^([+-])?\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/;

export function parseGermanAmount(input: string): number {
  const trimmed = input.trim().replace(/\s*(?:€|EUR)$/i, "");
  const match = GERMAN_AMOUNT.exec(trimmed);
  if (!match) {
    throw new Error(`Ungültiger Betrag: "${input}"`);
  }
  const [, sign, intPart = "", fraction = ""] = match;
  const cents = Number.parseInt(intPart.replaceAll(".", ""), 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`Betrag zu groß: "${input}"`);
  }
  return sign === "-" ? -cents : cents;
}

export function formatCents(cents: number, currency = "EUR"): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.trunc(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = (abs % 100).toString().padStart(2, "0");
  const symbol = currency === "EUR" ? "€" : currency;
  return `${negative ? "−" : ""}${euros},${rest} ${symbol}`;
}

const GERMAN_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/;

/** dd.mm.yyyy or dd.mm.yy → yyyy-mm-dd. Two-digit years are read as 20yy, bank exports never reach back further. */
export function parseGermanDate(input: string): string {
  const match = GERMAN_DATE.exec(input.trim());
  if (!match) {
    throw new Error(`Ungültiges Datum: "${input}"`);
  }
  const [, d = "", m = "", y = ""] = match;
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const month = Number(m);
  const day = Number(d);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(`Ungültiges Datum: "${input}"`);
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export type DecimalStyle = "de" | "en";

const ENGLISH_AMOUNT = /^([+-])?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Like parseGermanAmount, for exports with a decimal point (N26 and other international banks). */
export function parseEnglishAmount(input: string): number {
  const trimmed = input.trim().replace(/\s*(?:€|EUR)$/i, "");
  const match = ENGLISH_AMOUNT.exec(trimmed);
  if (!match) throw new Error(`Ungültiger Betrag: "${input}"`);
  const [, sign, intPart = "", fraction = ""] = match;
  const cents = Number.parseInt(intPart.replaceAll(",", ""), 10) * 100 + Number.parseInt(fraction.padEnd(2, "0"), 10);
  if (!Number.isSafeInteger(cents)) throw new Error(`Betrag zu groß: "${input}"`);
  return sign === "-" ? -cents : cents;
}

export function parseAmount(input: string, style: DecimalStyle): number {
  return style === "de" ? parseGermanAmount(input) : parseEnglishAmount(input);
}

/**
 * Decides the decimal separator from sample values. "1.234" alone is ambiguous, so only values with exactly
 * two digits after the last separator count as evidence.
 */
export function detectDecimalStyle(samples: string[]): DecimalStyle | null {
  let de = 0;
  let en = 0;
  for (const raw of samples) {
    const v = raw.trim().replace(/\s*(?:€|EUR)$/i, "");
    if (/,\d{2}$/.test(v)) de++;
    else if (/\.\d{2}$/.test(v)) en++;
  }
  if (de === 0 && en === 0) return null;
  return de >= en ? "de" : "en";
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** German dates, ISO dates, and dd/mm/yyyy. Anything else is an error, never a guess. */
export function parseDate(input: string): string {
  const v = input.trim();
  const iso = ISO_DATE.exec(v);
  if (iso) return parseGermanDate(`${iso[3]}.${iso[2]}.${iso[1]}`);
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (slash) return parseGermanDate(`${slash[1]}.${slash[2]}.${slash[3]}`);
  return parseGermanDate(v);
}
