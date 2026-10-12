import { describe, expect, it } from "vitest";
import { weekCompareText } from "./week-text";

describe("Wochenvergleich in Worten", () => {
  it("Montag früh, noch nichts ausgegeben: kein „0,00 € weniger“", () => {
    expect(weekCompareText({ spentCents: 0, usualCents: 3800 }, "Montag")).toBe(
      "Neue Woche, noch nichts ausgegeben. Sonst bis Montag: 38,00 €.",
    );
  });

  it("beides null: einfach nichts ausgegeben", () => {
    expect(weekCompareText({ spentCents: 0, usualCents: 0 }, "Dienstag")).toBe("Bisher nichts ausgegeben.");
  });

  it("genau wie sonst", () => {
    expect(weekCompareText({ spentCents: 5000, usualCents: 5000 }, "Mittwoch")).toBe("Genau wie sonst bis Mittwoch.");
  });

  it("weniger und mehr wie bisher, ohne Vergleich der Hinweis", () => {
    expect(weekCompareText({ spentCents: 3000, usualCents: 5000 }, "Mittwoch")).toBe(
      "20,00 € weniger als sonst bis Mittwoch",
    );
    expect(weekCompareText({ spentCents: 7000, usualCents: 5000 }, "Mittwoch")).toBe(
      "20,00 € mehr als sonst bis Mittwoch",
    );
    expect(weekCompareText({ spentCents: 7000, usualCents: null }, "Mittwoch")).toBe(
      "Für einen Vergleich fehlen noch ein paar Wochen.",
    );
  });
});
