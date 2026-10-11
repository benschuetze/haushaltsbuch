import { describe, expect, it } from "vitest";
import { boldSegments } from "./rich-text";

describe("Antworttext des Assistenten", () => {
  it("**fett** wird hervorgehoben statt mit Sternchen angezeigt", () => {
    expect(boldSegments("Mit **FitX (24,99 €)** und **Netflix** sparen.")).toEqual([
      { text: "Mit ", bold: false },
      { text: "FitX (24,99 €)", bold: true },
      { text: " und ", bold: false },
      { text: "Netflix", bold: true },
      { text: " sparen.", bold: false },
    ]);
  });

  it("ein einzelnes ** bleibt sichtbar, nichts verschwindet", () => {
    expect(boldSegments("2 ** 3 ist 8")).toEqual([{ text: "2 ** 3 ist 8", bold: false }]);
  });

  it("Text ohne Auszeichnung bleibt ein Stück, HTML bleibt Text", () => {
    expect(boldSegments("<b>hallo</b>")).toEqual([{ text: "<b>hallo</b>", bold: false }]);
  });
});
