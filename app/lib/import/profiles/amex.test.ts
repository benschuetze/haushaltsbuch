import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AMEX_PAYMENT, amexProfile } from "./amex";
import { detectBankProfile } from "./index";

const fixture = readFileSync("app/lib/import/profiles/__fixtures__/amex.csv");

describe("Bankprofil American Express", () => {
  const { rows, rejected, skipped } = amexProfile.parse(fixture);

  it("liest alle 7 Zeilen", () => {
    expect(rejected).toEqual([]);
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(7);
  });

  it("Einkäufe werden zu Ausgaben: Amex schreibt sie positiv, die App dreht das Vorzeichen", () => {
    expect(rows[0]).toMatchObject({
      bookingDate: "2026-09-15",
      amountCents: -1399,
      counterparty: "NETFLIX.COM AMSTERDAM",
    });
    expect(rows.find((r) => r.counterparty.startsWith("ARAL"))?.amountCents).toBe(-123456);
  });

  it("Gutschrift ist positiv, Umlaute bleiben heil", () => {
    expect(rows.find((r) => r.counterparty.startsWith("GUTSCHRIFT"))?.amountCents).toBe(1999);
    expect(rows.some((r) => r.counterparty === "RESTAURANT DA MARIO MÜNCHEN")).toBe(true);
  });

  it("der Kartenausgleich vom Bankkonto ist als solcher erkennbar", () => {
    expect(rows.find((r) => r.amountCents === 36749)).toMatchObject({
      counterparty: AMEX_PAYMENT,
      purpose: "ZAHLUNG ERHALTEN. BESTEN DANK.",
    });
  });

  it("wird am Kopf erkannt", () => {
    expect(detectBankProfile(fixture)?.id).toBe("amex");
  });
});
