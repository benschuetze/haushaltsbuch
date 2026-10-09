import { describe, expect, it } from "vitest";
import { BANK_TILES, tileState } from "./catalog";

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

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("Bank-Kacheln", () => {
  it("jedes Monogramm ist lesbar: Kontrast mindestens 4,5:1", () => {
    for (const t of BANK_TILES) {
      const [hi, lo] = [luminance(t.bg), luminance(t.fg)].sort((a, b) => b - a) as [number, number];
      expect((hi + 0.05) / (lo + 0.05), t.name).toBeGreaterThanOrEqual(4.5);
    }
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
