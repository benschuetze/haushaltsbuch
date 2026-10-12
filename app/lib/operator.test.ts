import { describe, expect, it } from "vitest";
import { imprintComplete, operatorInfo } from "./operator.server";

describe("Angaben zum Betreiber", () => {
  it("Anschrift aus einer Zeile mit Semikolon, leere Teile fallen weg", () => {
    const o = operatorInfo({
      PRIVACY_OPERATOR: " Erika Musterfrau ",
      OPERATOR_ADDRESS: "Musterweg 1; ;12345 Beispielstadt",
      PRIVACY_CONTACT_EMAIL: "kontakt@example.org",
    });
    expect(o).toEqual({
      name: "Erika Musterfrau",
      address: ["Musterweg 1", "12345 Beispielstadt"],
      email: "kontakt@example.org",
    });
    expect(imprintComplete(o)).toBe(true);
  });

  it("ohne Anschrift ist das Impressum nicht vollständig", () => {
    expect(imprintComplete(operatorInfo({ PRIVACY_OPERATOR: "Erika Musterfrau" }))).toBe(false);
    expect(operatorInfo({})).toEqual({ name: null, address: [], email: null });
  });
});
