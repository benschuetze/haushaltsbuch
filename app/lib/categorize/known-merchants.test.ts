import { describe, expect, it } from "vitest";
import { knownMerchantCategory } from "./known-merchants";

describe("eingebaute Händlerliste", () => {
  it.each([
    ["Lieferando.de", "Restaurant & Lieferdienst"],
    ["UBER EATS GERMANY", "Restaurant & Lieferdienst"],
    ["Uber BV", "Mobilität"],
    ["Disney Plus", "Abos & Verträge"],
    ["DisneyPlus", "Abos & Verträge"],
    ["FitX Deutschland GmbH", "Abos & Verträge"],
    ["Netflix International B.V.", "Abos & Verträge"],
    ["Telekom Deutschland", "Abos & Verträge"],
    ["REWE Markt", "Lebensmittel"],
    ["ALDI SUED", "Lebensmittel"],
    ["Shell Station 1234", "Mobilität"],
    ["dm-drogerie markt", "Haushalt"],
    ["Stadtwerke Beispielstadt", "Wohnen"],
    ["Musterversicherung AG", "Versicherungen"],
  ])("%s → %s", (counterparty, category) => {
    expect(knownMerchantCategory(counterparty, -1000)).toBe(category);
  });

  it.each([
    ["Deutsche Rentenversicherung", 142050],
    ["REWE Markt", 499],
    ["Allianz Versicherungs-AG", 12000],
  ])("ein Eingang ist nie eine Ausgabe-Kategorie: %s +%i", (counterparty, cents) => {
    // The list only knows expense categories: a pension, a refund or an insurance payout goes to the model.
    expect(knownMerchantCategory(counterparty, cents)).toBeNull();
  });

  it.each(["Michelle Shellhorn", "Zoe Müller", "Aldiana Reisen", "Lebensmittel Schmidt", "Arbeitgeber Muster GmbH"])(
    "kein Treffer, wo nur Buchstaben passen: %s",
    (counterparty) => {
      expect(knownMerchantCategory(counterparty, -1000)).toBeNull();
    },
  );
});
