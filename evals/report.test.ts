import { describe, expect, it } from "vitest";
import { renderReport } from "./report";
import { score } from "./score";

describe("Eval-Ergebnis als Tabelle", () => {
  it("enthält Datum, Modell, beide Stufen, stille Fehler und Tokens pro Buchung", () => {
    const report = score(
      [
        { id: "a", counterparty: "REWE", purpose: "x", amount_cents: -100, expected: "Lebensmittel" },
        { id: "b", counterparty: "Kiosk", purpose: "x", amount_cents: -100, expected: "Sonstiges" },
      ],
      [],
      new Map([
        ["a", { categoryId: "Lebensmittel", confidence: 1, needsReview: false }],
        ["b", { categoryId: "Sonstiges", confidence: 0.8, needsReview: false }],
      ]),
      (id) => id,
    );
    const md = renderReport(report, {
      date: "2026-10-12",
      model: "claude-test",
      cases: 2,
      freeCases: 1,
      modelCases: 1,
      modelAccuracy: 1,
      inputTokens: 900,
      outputTokens: 100,
    });
    expect(md).toContain("Lauf vom 2026-10-12, Modell `claude-test`, 2 erfundene Buchungen.");
    expect(md).toContain("| Ohne Modell entschieden (Händlerliste) | 1 von 2 (50,0 %) |");
    expect(md).toContain("| Falsch mit Konfidenz ≥ 0,7 (stille Fehler) | 0 |");
    expect(md).toContain("| Tokens pro Buchung ans Modell | 1000 (900 rein, 100 raus) |");
    expect(md).not.toContain("Verwechslungen");
  });
});
