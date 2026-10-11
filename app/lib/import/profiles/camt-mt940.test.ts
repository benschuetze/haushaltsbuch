import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { camt053Profile } from "./camt053";
import { detectBankProfile } from "./index";
import { germanIban, mt940Profile } from "./mt940";

const camt = readFileSync("app/lib/import/profiles/__fixtures__/camt053.xml");
const mt940 = readFileSync("app/lib/import/profiles/__fixtures__/mt940.sta");

describe("CAMT.053", () => {
  const { rows, rejected, skipped, ownIban } = camt053Profile.parse(camt);

  it("liest gebuchte Einträge, Vorgemerktes mit Grund übersprungen, eigene IBAN erkannt", () => {
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(skipped).toEqual([{ line: 4, reason: "vorgemerkt, noch nicht gebucht – kommt mit dem nächsten Auszug" }]);
    expect(ownIban).toBe("DE02120300000000202051");
  });

  it("Gutschrift positiv mit Auftraggeber, Lastschrift negativ mit Empfänger, mehrzeiliger Zweck", () => {
    expect(rows[0]).toMatchObject({
      bookingDate: "2026-10-01",
      amountCents: 361240,
      counterparty: "Arbeitgeber Muster GmbH",
    });
    expect(rows[1]).toMatchObject({
      amountCents: -89000,
      counterparty: "Hausverwaltung Sonnenhof",
      purpose: "Miete 10/2026 Whg 3",
    });
  });

  it("ohne Detailangaben trägt die Zusatzinfo, Umlaute heil", () => {
    expect(rows[2]).toMatchObject({ amountCents: -6312, purpose: "Kartenzahlung girocard REWE Markt Köln" });
  });

  it("wird erkannt; eine Datei mit eigener DOCTYPE-Deklaration wird abgelehnt", () => {
    expect(detectBankProfile(camt)?.id).toBe("camt053");
    const evil = new TextEncoder().encode(
      `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt/></Document>`,
    );
    expect(() => camt053Profile.parse(evil)).toThrow("DOCTYPE");
  });

  it("„&amp;“ im Namen wird zu „&“", () => {
    const xml = new TextEncoder().encode(
      new TextDecoder().decode(camt).replace("Arbeitgeber Muster GmbH", "H&amp;M Retail"),
    );
    expect(camt053Profile.parse(xml).rows[0]?.counterparty).toBe("H&M Retail");
  });
});

describe("MT940", () => {
  const { rows, rejected, ownIban } = mt940Profile.parse(mt940);

  it("liest alle :61:-Buchungen aus einer ISO-8859-1-Datei, Umlaute heil", () => {
    expect(rejected).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[3]).toMatchObject({
      bookingDate: "2026-10-05",
      amountCents: -123456,
      counterparty: "Elektro Müller",
      purpose: "Neuer KühlschrankRechnung 4711",
    });
  });

  it("Haben positiv, Soll negativ, Name aus ?32", () => {
    expect(rows[0]).toMatchObject({
      amountCents: 361240,
      counterparty: "Arbeitgeber Muster GmbH",
      purpose: "Gehalt 10/2026",
    });
    expect(rows[1]).toMatchObject({ amountCents: -89000, counterparty: "Hausverwaltung Sonnenhof" });
  });

  it("BLZ/Konto aus :25: wird zur IBAN mit richtiger Prüfziffer", () => {
    expect(germanIban("12030000", "0020205100")).toBe("DE02120300000020205100"); // checked independently (mod 97)
    expect(ownIban).toBe(germanIban("12030000", "0020205100"));
    // Known example IBAN: BLZ 37040044, Konto 0532013000.
    expect(germanIban("37040044", "532013000")).toBe("DE89370400440532013000");
  });

  it("wird erkannt, CSV nicht mit MT940 verwechselt", () => {
    expect(detectBankProfile(mt940)?.id).toBe("mt940");
    expect(detectBankProfile(readFileSync("beispieldaten/banken/dkb.csv"))?.id).toBe("dkb");
  });
});
