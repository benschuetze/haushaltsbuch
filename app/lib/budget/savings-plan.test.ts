import { describe, expect, it } from "vitest";
import { detectSavingsPlan } from "./savings-plan";

const monthly = (counterparty: string, cents: number, months: string[]) =>
  months.map((m) => ({ counterparty, amountCents: -cents, bookingDate: `${m}-15` }));

describe("Sparauftrag erkennen", () => {
  it("Monate hintereinander derselbe Betrag an dasselbe Konto: ein Vorschlag", () => {
    const plan = detectSavingsPlan(
      monthly("Eigenes Tagesgeld", 30000, ["2026-07", "2026-08", "2026-09"]),
      "2026-10-12",
    );
    expect(plan).toEqual({ counterparty: "Eigenes Tagesgeld", monthlyCents: 30000, months: 3 });
  });

  it("ein einzelner Monat ist noch kein Auftrag", () => {
    expect(detectSavingsPlan(monthly("Tagesgeld", 30000, ["2026-09"]), "2026-10-12")).toBeNull();
  });

  it("eine Lücke unterbricht die Reihe", () => {
    expect(detectSavingsPlan(monthly("Tagesgeld", 30000, ["2026-05", "2026-07", "2026-09"]), "2026-10-12")).toBeNull();
  });

  it("ein Auftrag, der vor Monaten aufgehört hat, ist kein Plan mehr", () => {
    expect(
      detectSavingsPlan(monthly("Tagesgeld", 30000, ["2026-03", "2026-04", "2026-05", "2026-06"]), "2026-10-12"),
    ).toBeNull();
  });

  it("wechselnde Beträge sind kein fester Sparauftrag", () => {
    const transfers = [
      ...monthly("Tagesgeld", 30000, ["2026-07"]),
      ...monthly("Tagesgeld", 12000, ["2026-08"]),
      ...monthly("Tagesgeld", 45000, ["2026-09"]),
    ];
    expect(detectSavingsPlan(transfers, "2026-10-12")).toBeNull();
  });

  it("Eingänge zählen nicht, bei mehreren Aufträgen gewinnt der größte", () => {
    const transfers = [
      ...monthly("Depot", 5000, ["2026-08", "2026-09", "2026-10"]),
      ...monthly("Tagesgeld", 20000, ["2026-07", "2026-08", "2026-09"]),
      ...monthly("Tagesgeld", -99999, ["2026-07", "2026-08", "2026-09"]),
    ];
    expect(detectSavingsPlan(transfers, "2026-10-12")).toEqual({
      counterparty: "Tagesgeld",
      monthlyCents: 20000,
      months: 3,
    });
  });
});
