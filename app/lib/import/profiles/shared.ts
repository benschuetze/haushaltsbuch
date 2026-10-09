import { decodeCsv, parseCsv } from "../csv";
import type { NormalizedRow, ParseResult } from "../types";

export type MappedRow = Omit<NormalizedRow, "line" | "raw">;

/** Thrown by a row mapper for rows that are valid but must not be imported yet, e.g. pending card payments. */
export class SkipRow extends Error {}

type Column = (name: string, occurrence?: number) => string;

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

/**
 * Shared walk over a bank export. Every data line ends up either as a row or as a rejection with its line
 * number and a reason; nothing is dropped silently except lines that are completely empty.
 */
export function parseTable(bytes: Uint8Array, spec: TableSpec): ParseResult {
  const records = parseCsv(decodeCsv(bytes), spec.delimiter);
  const headerIndex = findHeader(records, spec.requiredColumns);
  if (headerIndex < 0) {
    throw new Error(
      `Kopfzeile passt nicht zum Profil „${spec.label}“. Erwartet werden u. a. die Spalten: ${spec.requiredColumns.join(", ")}`,
    );
  }
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

    if (fields.length !== header.length) {
      rejected.push({ line, reason: `${fields.length} statt ${header.length} Spalten` });
      return;
    }
    const column: Column = (name, occurrence = 0) => {
      let idx = -1;
      for (let k = 0; k <= occurrence; k++) idx = header.indexOf(name, idx + 1);
      if (idx < 0) throw new Error(`Spalte „${name}“ fehlt`);
      return (fields[idx] ?? "").trim();
    };
    try {
      rows.push({ line, raw, ...spec.mapRow(column) });
    } catch (error) {
      const entry = { line, reason: error instanceof Error ? error.message : String(error) };
      (error instanceof SkipRow ? skipped : rejected).push(entry);
    }
  });
  return { rows, rejected, skipped };
}
