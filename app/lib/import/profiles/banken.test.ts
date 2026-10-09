import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { monthOf } from "~/lib/money";
import { bankProfiles, detectBankProfile, getBankProfile } from "./index";

type Expected = {
  profile: string;
  rows_total: number;
  booked: number;
  pending: number;
  sum_cents: number;
  months: Record<string, { rows: number; income_cents: number; expense_cents: number }>;
};

const expected: Record<string, Expected> = JSON.parse(readFileSync("beispieldaten/banken/erwartet.json", "utf8"));
const files = Object.entries(expected).filter(([name]) => name.endsWith(".csv"));
const read = (name: string) => new Uint8Array(readFileSync(`beispieldaten/banken/${name}`));

describe.each(files)("%s", (name, e) => {
  const bytes = read(name);
  const { rows, rejected, skipped } = getBankProfile(e.profile).parse(bytes);

  it("jede Zeile ist gebucht oder vorgemerkt, nichts abgelehnt, nichts verloren", () => {
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(e.booked);
    expect(skipped).toHaveLength(e.pending);
    expect(rows.length + skipped.length).toBe(e.rows_total);
  });

  it("Summe der gebuchten Beträge stimmt", () => {
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(e.sum_cents);
  });

  it("Einnahmen und Ausgaben je Monat stimmen", () => {
    for (const [month, m] of Object.entries(e.months)) {
      const inMonth = rows.filter((r) => monthOf(r.bookingDate) === month);
      expect(inMonth, month).toHaveLength(m.rows);
      expect(inMonth.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0)).toBe(m.income_cents);
      expect(inMonth.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0)).toBe(m.expense_cents);
    }
  });

  it("alle Daten liegen im erwarteten Zeitraum, alle Beträge sind EUR", () => {
    for (const r of rows) {
      expect(r.bookingDate >= "2026-09-01" && r.bookingDate <= "2026-10-08", r.bookingDate).toBe(true);
      expect(r.currency).toBe("EUR");
      expect(r.counterparty).not.toBe("");
    }
  });

  it(`wird als ${e.profile} erkannt und von keinem anderen Profil gelesen`, () => {
    expect(detectBankProfile(bytes)?.id).toBe(e.profile);
    for (const other of Object.values(bankProfiles).filter((p) => p.id !== e.profile)) {
      expect(other.matches(bytes), other.id).toBe(false);
    }
  });
});

describe("Besonderheiten der Formate", () => {
  it("Sparkasse: Windows-1252 mit Umlauten, zwei echte gleiche Kartenzahlungen, vorgemerkte Zeile mit Grund", () => {
    const { rows, skipped } = getBankProfile("sparkasse").parse(read("sparkasse.csv"));
    const baecker = rows.filter((r) => r.counterparty === "Bäckerei Müller");
    expect(baecker).toHaveLength(2);
    expect(baecker.every((r) => r.bookingDate === "2026-09-06" && r.amountCents === -320)).toBe(true);
    expect(rows.some((r) => r.counterparty === "Kaufland Größe Straße")).toBe(true);
    expect(skipped).toEqual([{ line: 2, reason: expect.stringMatching(/vorgemerkt/) }]);
  });

  it("ING: Vorspann wird übersprungen, Betrag kommt aus „Betrag“, nicht aus „Saldo“", () => {
    const { rows } = getBankProfile("ing").parse(read("ing.csv"));
    const bahn = rows.find((r) => r.counterparty.startsWith("Deutsche Bahn"));
    expect(bahn).toMatchObject({
      amountCents: -4290,
      bookingDate: "2026-10-04",
      purpose: expect.stringContaining("Köln"),
    });
    expect(bahn?.raw).toHaveProperty("Währung (2)", "EUR");
  });

  it("DKB: Gegenpartei hängt von der Richtung ab", () => {
    const { rows, skipped } = getBankProfile("dkb").parse(read("dkb.csv"));
    expect(rows.find((r) => r.amountCents === -5495)?.counterparty).toBe("Zalando SE");
    expect(rows.find((r) => r.amountCents === 41200)?.counterparty).toBe("Finanzamt Beispielstadt");
    expect(rows.find((r) => r.amountCents === -9214)?.purpose).toBe('Kartenzahlung "Wocheneinkauf"');
    expect(skipped).toHaveLength(1);
  });

  it("Volksbank: UTF-8 mit BOM, Umlaute bleiben erhalten", () => {
    const { rows } = getBankProfile("volksbank").parse(read("volksbank.csv"));
    expect(rows.some((r) => r.counterparty === "Hausarztpraxis Dr. Weiß")).toBe(true);
  });
});
