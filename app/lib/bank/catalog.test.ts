import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BANK_TILES, GROUPS, matchesSearch, tileState } from "./catalog";

const tile = (id: string) => {
  const t = BANK_TILES.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};

const LIST = [
  "DKB",
  "ING",
  "Sparkasse KölnBonn",
  "Sparkasse Hannover",
  "Sparkasse Hannover",
  "Deutsche Bank",
  "Deutsche Kreditbank",
  "Volksbank Mittelhessen",
  "N26",
];

describe("Bank-Kacheln", () => {
  it("jede Kachel hat ihr echtes Logo als Datei, keine Kachel ohne Gruppe", () => {
    for (const t of BANK_TILES) {
      expect(existsSync(`public/logos/${t.id}.png`), t.name).toBe(true);
      expect(
        GROUPS.some((g) => g.id === t.group),
        t.name,
      ).toBe(true);
    }
  });

  it("Suche findet beim Tippen, auch über frühere Namen, ohne Groß/klein und Umlaute", () => {
    const found = (q: string) => BANK_TILES.filter((t) => matchesSearch(t, q)).map((t) => t.id);
    expect(found("spark")).toEqual(["sparkasse"]);
    expect(found("Barcl")).toEqual(["easybank"]);
    expect(found("santander")).toEqual(["openbank"]);
    expect(found("AMEX")).toEqual(["amex"]);
    expect(found("hypo vereins")).toEqual(["hvb"]);
    expect(found("")).toHaveLength(BANK_TILES.length);
    expect(found("gibtsnicht")).toEqual([]);
  });

  it("genau eine passende Bank: direkt verbinden", () => {
    expect(tileState(tile("ing"), LIST)).toEqual({ kind: "direct", aspsp: "ING" });
    expect(tileState(tile("n26"), LIST)).toEqual({ kind: "direct", aspsp: "N26" });
  });

  it("mehrere Treffer (Sparkassen): erst auswählen, doppelte Namen nur einmal", () => {
    expect(tileState(tile("sparkasse"), LIST)).toEqual({
      kind: "choose",
      aspsps: ["Sparkasse KölnBonn", "Sparkasse Hannover"],
    });
  });

  it("Deutsche Bank und Deutsche Kreditbank (DKB) werden nicht verwechselt", () => {
    expect(tileState(tile("deutsche-bank"), LIST)).toEqual({ kind: "direct", aspsp: "Deutsche Bank" });
    expect(tileState(tile("dkb"), LIST)).toEqual({ kind: "choose", aspsps: ["DKB", "Deutsche Kreditbank"] });
  });

  it("PayPal und nicht gelistete Banken laufen über den Datei-Import", () => {
    expect(tileState(tile("paypal"), [...LIST, "PayPal"])).toEqual({ kind: "file" });
    expect(tileState(tile("revolut"), LIST)).toEqual({ kind: "file" });
    expect(tileState(tile("ing"), [])).toEqual({ kind: "file" });
  });

  it("jede Kachel hat eine eindeutige id und einen Export-Hinweis, PayPal steht vorne", () => {
    expect(new Set(BANK_TILES.map((t) => t.id)).size).toBe(BANK_TILES.length);
    expect(BANK_TILES.every((t) => t.fileHint.length > 0)).toBe(true);
    expect(BANK_TILES[0]?.id).toBe("paypal");
  });
});
