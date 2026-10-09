import { decodeCsv, parseCsv } from "../csv";
import type { NormalizedRow, ParseResult } from "../types";

export type MappedRow = Omit<NormalizedRow, "line" | "raw">;

/** Thrown by a row mapper for rows that are valid but must not be imported yet, e.g. pending card payments. */
export class SkipRow extends Error {}

export type Column = (name: string, occurrence?: number) => string;

type TableSpec = {
  label: string;
  delimiter: string;
  /** Columns that identify the header line. Banks put a preamble of varying length before it. */
  requiredColumns: string[];
  mapRow: (column: Column) => MappedRow;
};

function findHeader(records: string[][], required: string[]): number {
  return records.findIndex((r) => {
    const cells = r.map((c) => c.trim());
    return required.every((name) => cells.includes(name));
  });
}

export function looksLike(bytes: Uint8Array, spec: Pick<TableSpec, "delimiter" | "requiredColumns">): boolean {
  return findHeader(parseCsv(decodeCsv(bytes), spec.delimiter).slice(0, 40), spec.requiredColumns) >= 0;
}

const IBAN = /\b([A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?)\b/;
const OWN_ACCOUNT_COLUMN = /^(auftragskonto|iban auftragskonto|eigene iban|account iban|kontonummer auftragskonto)$/i;

/** The own IBAN sits either in the preamble (ING, DKB) or in a column that repeats it on every row (Sparkasse, VR). */
export function findOwnIban(records: string[][], headerIndex: number): string | undefined {
  for (const cell of records.slice(0, headerIndex).flat()) {
    const hit = IBAN.exec(cell.trim());
    if (hit?.[1]) return hit[1].replaceAll(" ", "");
  }
  const header = records[headerIndex] ?? [];
  const col = header.findIndex((h) => OWN_ACCOUNT_COLUMN.test(h.trim()));
  if (col < 0) return undefined;
  const values = new Set(
    records
      .slice(headerIndex + 1)
      .map((r) => r[col]?.trim() ?? "")
      .filter(Boolean),
  );
  const [only] = values;
  return values.size === 1 && only && IBAN.test(only) ? only.replaceAll(" ", "") : undefined;
}

const DATE_LIKE = /\d{1,4}[./-]\d{1,2}[./-]\d{2,4}/;

/**
 * Walks the data lines below a header. Every line ends up as a row, a rejection with line number and reason,
 * or a skip (pending booking, balance footer). Nothing is dropped silently except completely empty lines.
 */
export function walkTable(
  records: string[][],
  headerIndex: number,
  mapRow: (column: Column, fields: string[]) => MappedRow,
): ParseResult {
  const header = (records[headerIndex] ?? []).map((h) => h.trim());
  const rows: NormalizedRow[] = [];
  const rejected: ParseResult["rejected"] = [];
  const skipped: ParseResult["skipped"] = [];

  records.slice(headerIndex + 1).forEach((fields, i) => {
    const line = headerIndex + i + 2;
    if (fields.every((f) => f.trim() === "")) return;

    // Duplicate header names (ING has "Währung" twice) get a suffix so raw keeps every value.
    const seen = new Map<string, number>();
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => {
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      raw[n === 1 ? h : `${h} (${n})`] = fields[idx] ?? "";
    });

    // A trailing delimiter (comdirect) yields one extra empty field; that is not a broken line.
    const effective =
      fields.length === header.length + 1 && fields.at(-1)?.trim() === "" ? fields.slice(0, -1) : fields;
    if (effective.length !== header.length) {
      // A short line that does not start with a date is a balance line or note around the table, not a booking.
      const first = effective.find((f) => f.trim()) ?? "";
      if (!DATE_LIKE.test(first)) {
        skipped.push({ line, reason: "keine Buchung (z. B. Kontostand unter der Tabelle)" });
      } else {
        rejected.push({ line, reason: `${effective.length} statt ${header.length} Spalten` });
      }
      return;
    }
    const column: Column = (name, occurrence = 0) => {
      let idx = -1;
      for (let k = 0; k <= occurrence; k++) idx = header.indexOf(name, idx + 1);
      if (idx < 0) throw new Error(`Spalte „${name}“ fehlt`);
      return (effective[idx] ?? "").trim();
    };
    try {
      rows.push({ line, raw, ...mapRow(column, effective) });
    } catch (error) {
      const entry = { line, reason: error instanceof Error ? error.message : String(error) };
      (error instanceof SkipRow ? skipped : rejected).push(entry);
    }
  });
  return { rows, rejected, skipped, ownIban: findOwnIban(records, headerIndex) };
}

export function parseTable(bytes: Uint8Array, spec: TableSpec): ParseResult {
  const records = parseCsv(decodeCsv(bytes), spec.delimiter);
  const headerIndex = findHeader(records, spec.requiredColumns);
  if (headerIndex < 0) {
    throw new Error(
      `Kopfzeile passt nicht zum Profil „${spec.label}“. Erwartet werden u. a. die Spalten: ${spec.requiredColumns.join(", ")}`,
    );
  }
  return walkTable(records, headerIndex, spec.mapRow);
}
