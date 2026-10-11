import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import type { Db } from "~/lib/db/client";
import { accounts, transactions } from "~/lib/db/schema";
import expected from "../../../beispieldaten/erwartet.json";
import { createTestDb } from "../../../tests/helpers/db";
import { failingModel } from "../../../tests/helpers/models";
import { importCsv } from "./run";

const demoCsv = new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv"));
let db: Db;
let accountId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  const [account] = await db.select().from(accounts);
  if (!account) throw new Error("Demo-Konto fehlt");
  accountId = account.id;
});

describe("CSV-Import", () => {
  it("Demo-CSV: 44 neu, Summe stimmt mit erwartet.json", async () => {
    const result = await importCsv(db, { accountId, filename: "demo.csv", bytes: demoCsv, model: createMockModel() });
    expect(result).toMatchObject({ total: 44, inserted: 44, duplicates: 0, rejected: [] });
    const rows = await db.select().from(transactions);
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(expected.sum_cents);
  });

  it("dieselbe Datei zweimal: zweiter Lauf 0 neu, 44 Duplikate", async () => {
    await importCsv(db, { accountId, filename: "demo.csv", bytes: demoCsv, model: null });
    const second = await importCsv(db, { accountId, filename: "demo.csv", bytes: demoCsv, model: null });
    expect(second).toMatchObject({ total: 44, inserted: 0, duplicates: 44 });
    expect(await db.$count(transactions)).toBe(44);
  });

  it("Zeilen rein = neu + Duplikate + abgelehnt", async () => {
    const csv = [
      "Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung",
      "01.08.2026;01.08.2026;Arbeitgeber Muster GmbH;Gehalt 08/2026;3.612,40;EUR",
      "01.08.2026;01.08.2026;Kaputt;Betrag;abc;EUR",
      "40.08.2026;01.08.2026;Kaputt;Datum;-1,00;EUR",
      "09.10.2026;09.10.2026;Neu GmbH;Neu;-5,00;EUR",
    ].join("\n");
    await importCsv(db, { accountId, filename: "demo.csv", bytes: demoCsv, model: null });
    const result = await importCsv(db, { accountId, filename: "mix.csv", bytes: Buffer.from(csv), model: null });
    expect(result).toMatchObject({ total: 4, inserted: 1, duplicates: 1 });
    expect(result.rejected.map((r) => r.line)).toEqual([3, 4]);
    expect(result.inserted + result.duplicates + result.rejected.length).toBe(result.total);
  });

  it("ohne Modell landet alles, was weder eigene Regel noch Händlerliste kennt, in „prüfen“", async () => {
    const result = await importCsv(db, { accountId, filename: "demo.csv", bytes: demoCsv, model: null });
    expect(result.byAi).toBe(0);
    expect(result.byRule + result.needsReview).toBe(44);
    expect(result.needsReview).toBeGreaterThan(0);
    expect(await db.$count(transactions, eq(transactions.needsReview, true))).toBe(result.needsReview);
  });

  it("Modell fällt aus: Import klappt trotzdem, Buchungen landen in „prüfen“", async () => {
    const result = await importCsv(db, { accountId, filename: "demo.csv", bytes: demoCsv, model: failingModel() });
    expect(result).toMatchObject({ inserted: 44, byAi: 0 });
    expect(result.byRule + result.needsReview).toBe(44);
  });
});

describe("falsches Bankprofil", () => {
  it("nennt die passende Bank, statt nur „Kopfzeile passt nicht“ zu sagen", async () => {
    const bytes = new Uint8Array(readFileSync("beispieldaten/banken/ing.csv"));
    await expect(importCsv(db, { accountId, filename: "ing.csv", bytes, model: null })).rejects.toThrow(
      /sieht nach ING aus.*Girokonto \(Demo\)/,
    );
    expect(await db.$count(transactions)).toBe(0);
  });
});

describe("vorgemerkte Umsätze", () => {
  it("zählen in der Bilanz mit, werden aber nicht gespeichert", async () => {
    const [sparkasse] = await db
      .insert(accounts)
      .values({ name: "Sparkasse Giro", bankProfile: "sparkasse" })
      .returning();
    if (!sparkasse) throw new Error("Konto fehlt");
    const bytes = new Uint8Array(readFileSync("beispieldaten/banken/sparkasse.csv"));
    const result = await importCsv(db, { accountId: sparkasse.id, filename: "sparkasse.csv", bytes, model: null });
    expect(result).toMatchObject({ total: 20, inserted: 19, duplicates: 0, rejected: [] });
    expect(result.skipped).toHaveLength(1);
    expect(result.inserted + result.duplicates + result.rejected.length + result.skipped.length).toBe(result.total);
  });
});
