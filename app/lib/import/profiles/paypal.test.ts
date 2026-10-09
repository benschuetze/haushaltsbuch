import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectBankProfile } from "./index";
import { paypalProfile } from "./paypal";

const fixture = readFileSync("app/lib/import/profiles/__fixtures__/paypal.csv");

describe("Bankprofil PayPal", () => {
  const { rows, rejected, skipped } = paypalProfile.parse(fixture);

  it("jede der 14 Zeilen ist Buchung oder mit Grund übersprungen, nichts geht verloren", () => {
    expect(rejected).toEqual([]);
    expect(rows.length + skipped.length).toBe(14);
    expect(skipped.map((s) => s.reason)).toEqual([
      "USD-Betrag; der Euro-Betrag steht in der Umrechnungszeile",
      "USD-Betrag; der Euro-Betrag steht in der Umrechnungszeile",
      "bei PayPal „Ausstehend“, nicht gebucht",
      "bei PayPal „Storniert“, nicht gebucht",
    ]);
  });

  it("Zahlung: Händler als Gegenpartei, Artikel als Zweck, Betrag negativ in Cent, Datum ISO", () => {
    expect(rows[0]).toMatchObject({
      bookingDate: "2026-09-03",
      amountCents: -8900,
      counterparty: "Musikhaus Thomann GmbH",
      purpose: "Gitarrensaiten und Kabel",
    });
  });

  it("Abbuchung vom Bankkonto ist als Aufladung erkennbar, mit dem Händler im Zweck", () => {
    expect(rows[1]).toMatchObject({
      amountCents: 8900,
      counterparty: "PayPal (vom Bankkonto)",
      purpose: "Allgemeine Abbuchung – Bankkonto für Musikhaus Thomann GmbH",
    });
  });

  it("Fremdwährung: der Euro-Betrag der Umrechnung trägt den Namen des Shops", () => {
    expect(rows.find((r) => r.amountCents === -1842)).toMatchObject({
      counterparty: "Steam Games Ltd.",
      purpose: "Spielekauf (umgerechnet)",
    });
  });

  it("Erstattung und erhaltene Zahlung sind positiv, Umlaute bleiben heil", () => {
    expect(rows.find((r) => r.purpose.startsWith("Rücksendung"))?.amountCents).toBe(5995);
    expect(rows.find((r) => r.counterparty === "Kleinanzeigen Käufer Jörg")?.amountCents).toBe(2500);
  });

  it("wird am Kopf erkannt, ohne mit einem Bankprofil verwechselt zu werden", () => {
    expect(detectBankProfile(fixture)?.id).toBe("paypal");
  });
});
