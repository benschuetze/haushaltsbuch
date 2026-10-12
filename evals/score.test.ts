import { describe, expect, it } from "vitest";
import { score } from "./score";

const names: Record<string, string> = { food: "Lebensmittel", misc: "Sonstiges" };
const base = { purpose: "x", amount_cents: -100 };

describe("Eval-Auswertung", () => {
  it("zählt sichere Fehler getrennt, mehrdeutige Fälle in „prüfen“ gelten als richtig", () => {
    const report = score(
      [
        { ...base, id: "a", counterparty: "REWE", expected: "Lebensmittel" },
        { ...base, id: "b", counterparty: "Lidl", expected: "Lebensmittel" },
        { ...base, id: "c", counterparty: "Amazon EU S.a.r.l.", expected: "Sonstiges" },
        { ...base, id: "d", counterparty: "Aldi", expected: "Lebensmittel" },
      ],
      ["Amazon EU S.a.r.l."],
      new Map([
        ["a", { categoryId: "food", confidence: 0.9, needsReview: false }],
        ["b", { categoryId: "misc", confidence: 0.9, needsReview: false }],
        ["c", { categoryId: "food", confidence: 0.4, needsReview: true }],
        ["d", { categoryId: "misc", confidence: 0.5, needsReview: true }],
      ]),
      (id) => names[id],
    );
    expect(report.accuracy).toBe(0.5);
    expect(report.reviewShare).toBe(0.5);
    expect(report.wrongConfident.map((r) => r.id)).toEqual(["b"]);
  });
});

describe("Eval-Auswertung im Detail", () => {
  const cases = [
    { ...base, id: "a", counterparty: "REWE", expected: "Lebensmittel" },
    { ...base, id: "b", counterparty: "Lidl", expected: "Lebensmittel" },
    { ...base, id: "c", counterparty: "Kiosk", expected: "Sonstiges" },
    { ...base, id: "d", counterparty: "Aldi", expected: "Lebensmittel" },
  ];
  const report = score(
    cases,
    [],
    new Map([
      ["a", { categoryId: "food", confidence: 0.95, needsReview: false }],
      ["b", { categoryId: "misc", confidence: 0.75, needsReview: false }],
      ["c", { categoryId: "misc", confidence: 0.6, needsReview: true }],
      ["d", { categoryId: null, confidence: 0, needsReview: true }],
    ]),
    (id) => names[id],
  );

  it("Trefferquote je Kategorie und welche Kategorie verwechselt wurde", () => {
    expect(report.byCategory).toEqual([
      { category: "Lebensmittel", cases: 3, correct: 1, accuracy: 1 / 3 },
      { category: "Sonstiges", cases: 1, correct: 1, accuracy: 1 },
    ]);
    expect(report.confusions).toEqual([{ expected: "Lebensmittel", got: "Sonstiges", count: 1 }]);
  });

  it("Kalibrierung: Trefferquote je Konfidenzbereich, nur wo eine Kategorie genannt wurde", () => {
    expect(report.calibration.map((b) => [b.label, b.cases, b.accuracy])).toEqual([
      ["0–0,5", 0, null],
      ["0,5–0,7", 1, 1],
      ["0,7–0,9", 1, 0],
      ["0,9–1,0", 1, 1],
    ]);
  });

  it("andere Schwellen: höher heißt mehr prüfen, weniger stille Fehler", () => {
    const at = (t: number) => report.thresholds.find((x) => x.threshold === t);
    expect(at(0.7)).toEqual({ threshold: 0.7, reviewShare: 0.5, wrongConfident: 1 });
    expect(at(0.8)).toEqual({ threshold: 0.8, reviewShare: 0.75, wrongConfident: 0 });
  });
});
