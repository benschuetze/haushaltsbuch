import { XMLParser } from "fast-xml-parser";
import type { BankProfile, NormalizedRow, ParseResult } from "../types";

/**
 * CAMT.053 (ISO 20022 "BankToCustomerStatement"), the XML statement German banks offer next to CSV.
 * Covers the common versions (.001.02 to .001.08): status as text or as <Cd>, party names directly or under <Pty>.
 * Pending entries are skipped with a reason; nothing is dropped silently.
 */
const MARKER = /urn:iso:std:iso:20022:tech:xsd:camt\.05[23]\./;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  removeNSPrefix: true,
  // Only the five XML built-ins (&amp; …); files declaring their own entities are refused below.
  processEntities: true,
  htmlEntities: false,
  isArray: (name) => ["Stmt", "Rpt", "Ntry", "TxDtls", "Ustrd"].includes(name),
  parseTagValue: false,
});

type Node = Record<string, unknown>;
const get = (n: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((cur, key) => (cur && typeof cur === "object" ? (cur as Node)[key] : undefined), n);
const text = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return text((v as Node)["#text"]);
  return String(v).trim();
};

function cents(amount: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) throw new Error(`Ungültiger Betrag: "${amount}"`);
  const [euros, frac = ""] = amount.split(".");
  return Number(euros) * 100 + Number(frac.padEnd(2, "0"));
}

function partyName(party: unknown): string {
  return text(get(party, "Pty", "Nm")) || text(get(party, "Nm"));
}

function parse(bytes: Uint8Array): ParseResult {
  const xml = new TextDecoder("utf-8").decode(bytes);
  // A bank statement never needs a DTD; refusing it rules out entity expansion attacks ("billion laughs", XXE).
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Die XML-Datei enthält eine DOCTYPE-Deklaration und wird nicht gelesen.");
  const doc = parser.parse(xml) as Node;
  const root = (get(doc, "Document", "BkToCstmrStmt") ?? get(doc, "Document", "BkToCstmrAcctRpt")) as Node | undefined;
  if (!root) throw new Error("Kein CAMT.053-Kontoauszug (BkToCstmrStmt fehlt).");
  const statements = ((root.Stmt ?? root.Rpt) as Node[] | undefined) ?? [];
  const rows: NormalizedRow[] = [];
  const rejected: ParseResult["rejected"] = [];
  const skipped: ParseResult["skipped"] = [];
  let ownIban: string | undefined;
  let line = 0;

  for (const stmt of statements) {
    ownIban ??= text(get(stmt, "Acct", "Id", "IBAN")) || undefined;
    for (const entry of (stmt.Ntry as Node[] | undefined) ?? []) {
      line++;
      const status = text(get(entry, "Sts", "Cd")) || text(get(entry, "Sts"));
      if (status && status !== "BOOK") {
        skipped.push({ line, reason: "vorgemerkt, noch nicht gebucht – kommt mit dem nächsten Auszug" });
        continue;
      }
      try {
        const amount = cents(text(get(entry, "Amt")));
        const debit = text(get(entry, "CdtDbtInd")) === "DBIT";
        const date = text(get(entry, "BookgDt", "Dt")) || text(get(entry, "BookgDt", "DtTm")).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Buchungsdatum fehlt");
        const tx = ((get(entry, "NtryDtls", "TxDtls") as Node[] | undefined) ?? [])[0];
        const counterparty = partyName(get(tx, "RltdPties", debit ? "Cdtr" : "Dbtr"));
        const remittance = ((get(tx, "RmtInf", "Ustrd") as unknown[] | undefined) ?? []).map(text).join(" ");
        const additional = text(get(entry, "AddtlNtryInf"));
        rows.push({
          line,
          bookingDate: date,
          amountCents: debit ? -amount : amount,
          currency: text(get(entry, "Amt", "@Ccy")) || "EUR",
          counterparty: counterparty || additional,
          purpose: remittance || additional,
          raw: { status, date, additional, remittance },
        });
      } catch (error) {
        rejected.push({ line, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { rows, rejected, skipped, ownIban };
}

export const camt053Profile: BankProfile = {
  id: "camt053",
  label: "CAMT.053",
  matches: (bytes) => MARKER.test(new TextDecoder("utf-8").decode(bytes.slice(0, 2000))),
  parse,
};
