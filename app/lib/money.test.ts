import { describe, expect, it } from "vitest";
import { formatCents, parseGermanAmount, parseGermanDate } from "./money";

describe("parseGermanAmount", () => {
  it.each([
    ["-1.234,56", -123456],
    ["1.234,56", 123456],
    ["3.612,40", 361240],
    ["-0,99", -99],
    ["259,00", 25900],
    ["12", 1200],
    ["-8,4", -840],
    ["+15,00", 1500],
    ["1.000.000,01", 100000001],
    ["  -21,90 ", -2190],
    ["-21,90 €", -2190],
  ])("%s → %i Cent", (input, cents) => {
    expect(parseGermanAmount(input)).toBe(cents);
  });

  it("rechnet ohne Float-Fehler: 0,10 + 0,20 ist genau 30 Cent", () => {
    expect(parseGermanAmount("0,10") + parseGermanAmount("0,20")).toBe(30);
  });

  it.each(["abc", "", "1,234.56", "12,345", "1.23,45", "--5,00", "5,00-"])("lehnt %j ab", (input) => {
    expect(() => parseGermanAmount(input)).toThrow(/Ungültiger Betrag/);
  });
});

describe("formatCents", () => {
  it.each([
    [123456, "1.234,56 €"],
    [-123456, "−1.234,56 €"],
    [5, "0,05 €"],
    [0, "0,00 €"],
    [100000001, "1.000.000,01 €"],
  ])("%i → %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it("Formatieren und Parsen ergeben wieder denselben Betrag", () => {
    for (const cents of [-123456, -1, 0, 7, 99, 100, 361240]) {
      expect(parseGermanAmount(formatCents(cents).replace("−", "-"))).toBe(cents);
    }
  });
});

describe("parseGermanDate", () => {
  it.each([
    ["01.08.2026", "2026-08-01"],
    ["1.8.2026", "2026-08-01"],
    ["29.02.28", "2028-02-29"],
  ])("%s → %s", (input, iso) => {
    expect(parseGermanDate(input)).toBe(iso);
  });

  it.each(["31.09.2026", "29.02.2027", "2026-08-01", "", "00.01.2026"])("lehnt %j ab", (input) => {
    expect(() => parseGermanDate(input)).toThrow(/Ungültiges Datum/);
  });
});
