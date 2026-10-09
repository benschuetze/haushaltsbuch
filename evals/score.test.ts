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
