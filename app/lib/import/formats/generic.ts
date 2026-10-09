import { detectDecimalStyle, parseAmount, parseDate } from "~/lib/money";
import { decodeCsv, parseCsv } from "../csv";
import { SkipRow, walkTable } from "../profiles/shared";
import type { ParseResult } from "../types";
import { type ColumnMapping, columnMappingSchema } from "./mapping";

const DELIMITERS = [";", ",", "\t"] as const;

export type Table = {
  delimiter: ColumnMapping["delimiter"];
  records: string[][];
  headerIndex: number;
  header: string[];
};

const LETTERS = /[A-Za-zÄÖÜäöüß]/;

/**
 * The header is the first line with at least four mostly textual cells whose next non-empty line has the
 * same width. That skips any preamble (balances, IBAN, period) without knowing the bank.
 */
function findTable(records: string[][]): number {
  for (let i = 0; i < Math.min(records.length, 40); i++) {
    const cells = (records[i] ?? []).map((c) => c.trim());
    const filled = cells.filter(Boolean);
    if (
      filled.length < 4 ||
      filled.filter((c) => LETTERS.test(c) && !/\d{2}[./-]\d{2}/.test(c)).length < filled.length * 0.8
    ) {
      continue;
    }
    const next = records.slice(i + 1).find((r) => r.some((c) => c.trim()));
    if (next && Math.abs(next.length - cells.length) <= 1) return i;
  }
  return -1;
}

export function readTable(bytes: Uint8Array): Table | null {
  const text = decodeCsv(bytes);
  let best: Table | null = null;
  for (const delimiter of DELIMITERS) {
    const records = parseCsv(text, delimiter);
    const headerIndex = findTable(records);
    if (headerIndex < 0) continue;
    const header = (records[headerIndex] ?? []).map((h) => h.trim());
    if (!best || header.length > best.header.length) best = { delimiter, records, headerIndex, header };
  }
  return best;
}

/** Same header in the same format means same bank format; column order and names are what identify it. */
export function headerSignature(table: Pick<Table, "delimiter" | "header">): string {
  return [table.delimiter, ...table.header.map((h) => h.toLowerCase().replace(/\s+/g, " "))].join("|");
}

export function dataRows(table: Table, limit = 50): string[][] {
  return table.records
    .slice(table.headerIndex + 1)
    .filter((r) => r.length >= table.header.length && r.some((c) => c.trim()))
    .slice(0, limit);
}

const PENDING = /vorgemerkt|pending|reserviert|nicht gebucht/i;

export function parseWithMapping(table: Table, mapping: ColumnMapping): ParseResult {
  const at = (fields: string[], idx: number | undefined) => (idx === undefined ? "" : (fields[idx] ?? "").trim());
  return walkTable(table.records, table.headerIndex, (_column, fields) => {
    if (mapping.status !== undefined && PENDING.test(at(fields, mapping.status))) {
      throw new SkipRow("vorgemerkt, noch nicht gebucht – kommt mit dem nächsten Export");
    }
    let amountCents: number;
    if (mapping.amount !== undefined) {
      amountCents = parseAmount(at(fields, mapping.amount), mapping.decimal);
    } else {
      // Soll is often given without a minus sign; a debit always reduces the balance.
      const debit = at(fields, mapping.debit);
      const credit = at(fields, mapping.credit);
      amountCents = debit ? -Math.abs(parseAmount(debit, mapping.decimal)) : parseAmount(credit, mapping.decimal);
    }
    const purpose = at(fields, mapping.purpose);
    let counterparty =
      mapping.payer !== undefined && mapping.payee !== undefined
        ? at(fields, amountCents < 0 ? mapping.payee : mapping.payer)
        : at(fields, mapping.counterparty);
    let cleanPurpose = purpose;
    if (!counterparty) {
      const split = splitCombinedText(purpose);
      counterparty = split.counterparty;
      cleanPurpose = split.purpose;
    }
    return {
      bookingDate: parseDate(at(fields, mapping.date)),
      amountCents,
      currency: at(fields, mapping.currency) || "EUR",
      counterparty,
      purpose: cleanPurpose,
    };
  });
}

/**
 * Some banks (comdirect) pack the other party into the text: "Auftraggeber: X Buchungstext: Y Ref. …".
 * Without such a marker the start of the text stands in for the counterparty, so rules still have something to match.
 */
export function splitCombinedText(text: string): { counterparty: string; purpose: string } {
  const match =
    /(?:Auftraggeber|Empfänger|Zahlungsempfänger|Begünstigter|Zahlungspflichtiger)\s*:\s*(.+?)\s+(?:Buchungstext|Verwendungszweck)\s*:\s*(.*)$/i.exec(
      text,
    );
  if (match?.[1]) {
    return {
      // comdirect appends the other party's account: "REWE Kto/IBAN: DE… BLZ/BIC: …". That is not part of the name.
      counterparty: match[1].replace(/\s+(?:Kto\/IBAN|IBAN|BLZ\/BIC|BIC)\s*:.*$/i, "").trim(),
      purpose: (match[2] ?? "").replace(/\s+Ref\.\s+\S+\s*$/, "").trim(),
    };
  }
  return { counterparty: text.slice(0, 60).trim(), purpose: text };
}

type Rule = { field: keyof ColumnMapping; pattern: RegExp; avoid?: RegExp };

// Order matters: the first matching rule claims a column, so specific names come before generic ones.
const RULES: Rule[] = [
  { field: "date", pattern: /^(buchungstag|buchungsdatum|buchung|booking date|transaction date|datum|date)$/i },
  { field: "debit", pattern: /^soll\b|^debit|^ausgang/i },
  { field: "credit", pattern: /^haben\b|^credit|^eingang/i },
  {
    field: "amount",
    // "Betrag", "Betrag (€)", "Umsatz in EUR", "Amount (EUR)" – but not "Umsatzart".
    pattern: /^(betrag|umsatz|amount)(\s*\(.*\)|\s+in\s+\w+)?$/i,
    avoid: /saldo|ursprung|fremd|gebühr|balance/i,
  },
  { field: "payee", pattern: /zahlungsempfänger|^empfänger$|^payee/i },
  { field: "payer", pattern: /zahlungspflichtige|^auftraggeber$|^payer/i },
  {
    field: "counterparty",
    pattern:
      /empfänger|auftraggeber|begünstigter|zahlungsbeteiligter|partner name|^name|counterparty|gegenkonto.*name/i,
    avoid: /iban|bic|konto|abweichend/i,
  },
  {
    field: "purpose",
    pattern: /^verwendungszweck$|^zweck$|payment reference|^reference$|^beschreibung$|^description$/i,
  },
  { field: "purpose", pattern: /^buchungstext$/i },
  { field: "purpose", pattern: /^vorgang$|^text$|^umsatzart$|^memo$/i },
  { field: "currency", pattern: /^(währung|waehrung|currency)$/i },
  { field: "status", pattern: /^(status|info)$/i },
];

/**
 * Free, local guess of the column mapping from header names alone. Returns null rather than a shaky guess;
 * the caller then decides whether the LLM may try.
 */
export function guessMapping(table: Table): ColumnMapping | null {
  const mapping: Partial<Record<keyof ColumnMapping, number>> = {};
  const taken = new Set<number>();
  for (const rule of RULES) {
    if (mapping[rule.field] !== undefined) continue;
    const idx = table.header.findIndex(
      (h, i) => !taken.has(i) && rule.pattern.test(h) && !(rule.avoid?.test(h) ?? false),
    );
    if (idx >= 0) {
      mapping[rule.field] = idx;
      taken.add(idx);
    }
  }
  // Payer and payee only make sense as a pair; a lone match is the counterparty.
  if ((mapping.payer === undefined) !== (mapping.payee === undefined)) {
    mapping.counterparty ??= mapping.payer ?? mapping.payee;
    delete mapping.payer;
    delete mapping.payee;
  }
  if (mapping.amount !== undefined) {
    delete mapping.debit;
    delete mapping.credit;
  }
  const amountColumns = [mapping.amount, mapping.debit, mapping.credit].filter((i): i is number => i !== undefined);
  const decimal = detectDecimalStyle(dataRows(table).flatMap((r) => amountColumns.map((i) => r[i] ?? "")));
  const parsed = columnMappingSchema.safeParse({ ...mapping, delimiter: table.delimiter, decimal: decimal ?? "de" });
  return parsed.success && decimal ? parsed.data : null;
}

/** A mapping is only trusted if it reads the actual file: most data lines must parse, at least one must. */
export function mappingWorks(table: Table, mapping: ColumnMapping): boolean {
  const { rows, rejected } = parseWithMapping(table, mapping);
  return rows.length > 0 && rows.length >= (rows.length + rejected.length) * 0.8;
}
