import { describe, expect, it } from "vitest";
import { savingsText } from "./savings";

describe("Sparpotenzial in Worten", () => {
  it("doppelte Dienste sind eine Untergrenze: „mindestens“", () => {
    expect(savingsText([{ kind: "duplicate_service", savingsCentsPerYear: 11988 }])).toBe(
      "mindestens 119,88 € im Jahr",
    );
  });

  it("sobald hochgerechnete Gebühren dabei sind: „etwa“", () => {
    expect(
      savingsText([
        { kind: "duplicate_service", savingsCentsPerYear: 11988 },
        { kind: "fees", savingsCentsPerYear: 10740 },
      ]),
    ).toBe("etwa 227,28 € im Jahr");
  });

  it("ohne Sparpotenzial kein Text", () => {
    expect(savingsText([{ kind: "price_increase", savingsCentsPerYear: null }])).toBeNull();
  });
});
