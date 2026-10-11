import { decodeCsv } from "../csv";
import type { BankProfile, NormalizedRow, ParseResult } from "../types";

/**
 * MT940 (SWIFT statement, "STA"), still offered by Sparkassen and Volksbanken. Each booking is a :61: line
 * (dates, debit/credit, amount) followed by :86: with the German structured fields: ?00 posting text,
 * ?20–?29 purpose, ?32–?33 payee name. Usually ISO-8859-1.
 */
const LINE_61 = /^(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])[A-Z]?(\d+,\d{0,2})/;

/** German account from "BLZ/Kontonummer" as IBAN (check digits per ISO 13616), so uploads find their account. */
export function germanIban(blz: string, account: string): string {
  const bban = blz + account.padStart(10, "0");
  const numeric = `${bban}131400`; // "DE00" with D=13, E=14
  let rest = 0;
  for (const digit of numeric) rest = (rest * 10 + Number(digit)) % 97;
  return `DE${String(98 - rest).padStart(2, "0")}${bban}`;
}

function field86(raw: string): { counterparty: string; purpose: string } {
  if (!raw.includes("?")) return { counterparty: "", purpose: raw.trim() };
  const parts = new Map<string, string>();
  for (const m of raw.matchAll(/\?(\d{2})([^?]*)/g))
    parts.set(m[1] as string, `${parts.get(m[1] as string) ?? ""}${m[2]}`);
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => parts.get(String(from + i).padStart(2, "0")) ?? "").join("");
  // Purpose lines are cut at 27 characters, often mid-word, so they are joined without a space.
  const purpose = range(20, 29).trim() || (parts.get("00") ?? "").trim();
  const counterparty = range(32, 33).trim() || (parts.get("00") ?? "").trim();
  return { counterparty, purpose };
}

function parse(bytes: Uint8Array): ParseResult {
  const lines = decodeCsv(bytes).split(/\r?\n/);
  // Continuation lines belong to the tag above them.
  const tags: { tag: string; value: string; line: number }[] = [];
  lines.forEach((l, i) => {
    const m = /^:(\d{2}[A-Z]?):(.*)$/.exec(l);
    if (m) tags.push({ tag: m[1] as string, value: m[2] as string, line: i + 1 });
    else if (tags.length > 0 && l !== "-" && l.trim() !== "") (tags.at(-1) as { value: string }).value += l;
  });

  const rows: NormalizedRow[] = [];
  const rejected: ParseResult["rejected"] = [];
  let ownIban: string | undefined;
  for (const [i, t] of tags.entries()) {
    if (t.tag === "25" && !ownIban) {
      const v = t.value.trim().replace(/\s/g, "");
      const blz = /^(\d{8})\/(\d{1,10})/.exec(v);
      ownIban = /^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(v)
        ? v
        : blz
          ? germanIban(blz[1] as string, blz[2] as string)
          : undefined;
    }
    if (t.tag !== "61") continue;
    const m = LINE_61.exec(t.value);
    if (!m) {
      rejected.push({ line: t.line, reason: "Buchungszeile :61: nicht lesbar" });
      continue;
    }
    const [, yy, mm, dd, , mark, amount] = m as unknown as string[];
    const [euros, frac = ""] = (amount as string).split(",");
    const value = Number(euros) * 100 + Number(frac.padEnd(2, "0"));
    // C/RD increase the balance, D/RC decrease it.
    const credit = mark === "C" || mark === "RD";
    const next = tags[i + 1];
    const details = next?.tag === "86" ? field86(next.value) : { counterparty: "", purpose: "" };
    rows.push({
      line: t.line,
      bookingDate: `20${yy}-${mm}-${dd}`,
      amountCents: credit ? value : -value,
      currency: "EUR",
      counterparty: details.counterparty,
      purpose: details.purpose,
      raw: { "61": t.value, "86": next?.tag === "86" ? next.value : "" },
    });
  }
  return { rows, rejected, skipped: [], ownIban };
}

export const mt940Profile: BankProfile = {
  id: "mt940",
  label: "MT940",
  matches: (bytes) => {
    const head = decodeCsv(bytes.slice(0, 4000));
    return /^:20:/m.test(head) && /^:25:/m.test(head) && /^:61:/m.test(head);
  },
  parse,
};
