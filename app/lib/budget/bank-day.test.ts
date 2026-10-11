import { describe, expect, it } from "vitest";
import { bankDay } from "./bank-day";

describe("nächster Bankarbeitstag", () => {
  it.each([
    ["2026-10-12", "2026-10-12", "Montag bleibt"],
    ["2026-10-11", "2026-10-12", "Sonntag → Montag"],
    ["2026-11-01", "2026-11-02", "Gehalt am Sonntag → Montag"],
    ["2026-10-03", "2026-10-05", "Tag der Deutschen Einheit, Samstag"],
    ["2026-12-24", "2026-12-28", "Heiligabend, beide Weihnachtstage, Wochenende"],
    ["2026-12-31", "2027-01-04", "Silvester, Neujahr (Fr), Wochenende"],
    ["2027-03-26", "2027-03-30", "Karfreitag bis Ostermontag"],
    ["2026-05-14", "2026-05-15", "Christi Himmelfahrt 2026"],
    ["2026-05-25", "2026-05-26", "Pfingstmontag 2026"],
    ["2026-05-01", "2026-05-04", "Tag der Arbeit (Fr)"],
  ])("%s → %s (%s)", (date, expected) => {
    expect(bankDay(date)).toBe(expected);
  });
});
