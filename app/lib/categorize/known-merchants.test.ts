import { describe, expect, it } from "vitest";
import { knownMerchantCategory } from "./known-merchants";

describe("eingebaute Händlerliste", () => {
  it.each([
    ["Lieferando.de", "Restaurant & Lieferdienst"],
    ["UBER EATS GERMANY", "Restaurant & Lieferdienst"],
    ["Uber BV", "Mobilität"],
    ["Disney Plus", "Abos & Software"],
    ["DisneyPlus", "Abos & Software"],
    ["FitX Deutschland GmbH", "Abos & Software"],
    ["Netflix International B.V.", "Abos & Software"],
    ["Telekom Deutschland", "Abos & Software"],
    ["REWE Markt", "Lebensmittel"],
    ["ALDI SUED", "Lebensmittel"],
    ["Shell Station 1234", "Mobilität"],
    ["dm-drogerie markt", "Haushalt"],
    ["Stadtwerke Beispielstadt", "Wohnen"],
    ["Musterversicherung AG", "Versicherungen"],
  ])("%s → %s", (counterparty, category) => {
    expect(knownMerchantCategory(counterparty)).toBe(category);
  });

  it.each(["Michelle Shellhorn", "Zoe Müller", "Aldiana Reisen", "Lebensmittel Schmidt", "Arbeitgeber Muster GmbH"])(
    "kein Treffer, wo nur Buchstaben passen: %s",
    (counterparty) => {
      expect(knownMerchantCategory(counterparty)).toBeNull();
    },
  );
});
