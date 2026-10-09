import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { monthOf } from "~/lib/money";
import expected from "../../../../beispieldaten/erwartet.json";
import { demoProfile } from "./demo";

const demoCsv = readFileSync("beispieldaten/demo-umsaetze.csv");
const HEADER = "Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung";

function csv(...lines: string[]): string {
  return [HEADER, ...lines].join("\r\n");
}

describe("Bankprofil Standard mit der Demo-CSV", () => {
  const { rows, rejected } = demoProfile.parse(demoCsv);

  it("liest alle Zeilen, keine wird abgelehnt", () => {
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(expected.rows_total);
  });

  it("Summe aller Beträge stimmt mit der nachgerechneten Summe überein", () => {
    expect(rows.reduce((sum, r) => sum + r.amountCents, 0)).toBe(expected.sum_cents);
  });

  it.each(Object.entries(expected.months))("Monat %s: Zeilen, Einnahmen und Ausgaben stimmen", (month, m) => {
    const inMonth = rows.filter((r) => monthOf(r.bookingDate) === month);
    expect(inMonth).toHaveLength(m.rows);
    expect(inMonth.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0)).toBe(m.income_cents);
    expect(inMonth.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0)).toBe(m.expense_cents);
  });

  it("übernimmt Datum, Betrag, Empfänger und Zweck der ersten Zeile", () => {
    expect(rows[0]).toMatchObject({
      line: 2,
      bookingDate: "2026-08-01",
      amountCents: 361240,
      currency: "EUR",
      counterparty: "Arbeitgeber Muster GmbH",
      purpose: "Gehalt 08/2026",
    });
    expect(rows[1]?.amountCents).toBe(-89000);
  });
});

describe("Bankprofil Standard: Sicherheitsnetz", () => {
  it("lehnt kaputte Zeilen mit Zeilennummer und Grund ab und importiert den Rest", () => {
    const { rows, rejected } = demoProfile.parse(
      Buffer.from(
        csv(
          "01.08.2026;01.08.2026;REWE Markt;Einkauf;-10,00;EUR",
          "32.08.2026;01.08.2026;REWE Markt;Einkauf;-11,00;EUR",
          "02.08.2026;02.08.2026;REWE Markt;Einkauf;abc;EUR",
          "03.08.2026;03.08.2026;nur drei;Spalten",
          "04.08.2026;04.08.2026;Lidl;Einkauf;-1.234,56;EUR",
        ),
      ),
    );
    expect(rows.map((r) => r.line)).toEqual([2, 6]);
    expect(rejected).toEqual([
      { line: 3, reason: expect.stringMatching(/Ungültiges Datum/) },
      { line: 4, reason: expect.stringMatching(/Ungültiger Betrag/) },
      { line: 5, reason: expect.stringMatching(/4 statt 6 Spalten/) },
    ]);
    // Every line is accounted for: imported or rejected with a reason.
    expect(rows.length + rejected.length).toBe(5);
  });

  it("überspringt nur wirklich leere Zeilen am Ende", () => {
    const { rows, rejected } = demoProfile.parse(Buffer.from(`${csv("01.08.2026;01.08.2026;A;B;1,00;EUR")}\r\n\r\n`));
    expect(rows).toHaveLength(1);
    expect(rejected).toEqual([]);
  });

  it("lehnt eine fremde Kopfzeile als Ganzes ab, statt Spalten zu raten", () => {
    expect(() => demoProfile.parse(Buffer.from("Datum;Betrag\n01.08.2026;1,00"))).toThrow(/Kopfzeile/);
  });
});

describe("Bankprofil Standard: Encoding", () => {
  const line = "05.08.2026;05.08.2026;Bäckerei Größe;Brötchen für Kita;-1.234,56;EUR";

  it("liest ISO-8859-1 mit Umlauten", () => {
    const { rows } = demoProfile.parse(Buffer.from(csv(line), "latin1"));
    expect(rows[0]).toMatchObject({
      counterparty: "Bäckerei Größe",
      purpose: "Brötchen für Kita",
      amountCents: -123456,
    });
  });

  it("liest UTF-8 mit BOM", () => {
    const { rows } = demoProfile.parse(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csv(line))]));
    expect(rows[0]?.counterparty).toBe("Bäckerei Größe");
  });

  it("liest Felder in Anführungszeichen mit Semikolon und Zeilenumbruch", () => {
    const { rows } = demoProfile.parse(
      Buffer.from(csv('06.08.2026;06.08.2026;"Müller; Söhne";"Rechnung\n4711 ""Eilt""";1.234,56;EUR')),
    );
    expect(rows[0]).toMatchObject({
      counterparty: "Müller; Söhne",
      purpose: 'Rechnung\n4711 "Eilt"',
      amountCents: 123456,
    });
  });
});
