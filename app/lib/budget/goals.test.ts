import { describe, expect, it } from "vitest";
import { type AvailableBooking, availableToSpend } from "./available";
import { type GoalInput, goalStatus, type MonthFlow, planPurchase } from "./goals";

const mallorca = (deposits: GoalInput["deposits"] = []): GoalInput => ({
  id: "g1",
  name: "Mallorca",
  targetCents: 80000,
  dueMonth: "2027-01",
  monthlyCents: null,
  deposits,
});

describe("Sparziel mit Termin", () => {
  it("800 € bis Januar, heute 9. Oktober: vier Monate (Okt–Jan), 200 € im Monat", () => {
    expect(goalStatus(mallorca(), "2026-10-09", "2026-10-01")).toMatchObject({
      monthsLeft: 4,
      perMonthCents: 20000,
      stillToReserveCents: 20000,
      savedCents: 0,
      done: false,
    });
  });

  it("diesen Monat schon 150 € zurückgelegt: die Rate bleibt 200 €, offen sind 50 €", () => {
    const g = goalStatus(mallorca([{ amountCents: 15000, depositedOn: "2026-10-05" }]), "2026-10-09", "2026-10-01");
    expect(g).toMatchObject({ perMonthCents: 20000, depositedThisPeriodCents: 15000, stillToReserveCents: 5000 });
  });

  it("früher gespart verkleinert die Rate: 200 € aus dem September, 600 € auf vier Monate", () => {
    const g = goalStatus(mallorca([{ amountCents: 20000, depositedOn: "2026-09-10" }]), "2026-10-09", "2026-10-01");
    expect(g.perMonthCents).toBe(15000);
  });

  it("Termin vorbei: der ganze Rest auf einmal", () => {
    const g = goalStatus(mallorca([{ amountCents: 30000, depositedOn: "2026-12-01" }]), "2027-03-02", "2027-03-01");
    expect(g).toMatchObject({ monthsLeft: 1, perMonthCents: 50000 });
  });

  it("erreicht: nichts mehr zu reservieren", () => {
    const g = goalStatus(mallorca([{ amountCents: 80000, depositedOn: "2026-10-01" }]), "2026-10-09", "2026-10-01");
    expect(g).toMatchObject({ done: true, perMonthCents: 0, stillToReserveCents: 0, remainingCents: 0 });
  });

  it("ohne Termin, feste Monatsrate; nie mehr als der Rest", () => {
    const g: GoalInput = { ...mallorca(), dueMonth: null, monthlyCents: 5000, targetCents: 3000 };
    expect(goalStatus(g, "2026-10-09", "2026-10-01").perMonthCents).toBe(3000);
  });
});

describe("Sparziel im Tagesbudget", () => {
  const salary = (d: string): AvailableBooking => ({
    bookingDate: d,
    counterparty: "Arbeitgeber",
    purpose: "",
    amountCents: 300000,
    categoryName: "Einkommen",
    categoryKind: "income",
  });
  const bookings = [salary("2026-08-01"), salary("2026-09-01"), salary("2026-10-01")];

  it("die offene Monatsrate steht unter „noch fällig“ und senkt den Tagesbetrag", () => {
    const without = availableToSpend(bookings, "2026-10-09");
    const withGoal = availableToSpend(bookings, "2026-10-09", [mallorca()]);
    expect(withGoal.upcoming).toContainEqual({ name: "Sparziel Mallorca", date: "2026-10-09", amountCents: 20000 });
    expect(without.freeCents - withGoal.freeCents).toBe(20000);
  });
});

describe("Wann kann ich mir das leisten?", () => {
  const months: MonthFlow[] = [
    { month: "2026-07", incomeCents: 300000, spentCents: 220000, savedCents: 30000 },
    { month: "2026-08", incomeCents: 300000, spentCents: 240000, savedCents: 30000 },
    { month: "2026-09", incomeCents: 300000, spentCents: 230000, savedCents: 30000 },
    { month: "2026-10", incomeCents: 300000, spentCents: 50000, savedCents: 0 },
  ];

  it("Durchschnitt der letzten vollen Monate, laufender zählt nicht: 400 € übrig; 1.200 € mit 200 € frei → im Januar", () => {
    // (3000−2200−300 + 3000−2400−300 + 3000−2300−300) / 3 = 400 €; missing 1.200 − 200 = 1.000 → 3 months
    expect(planPurchase(months, 120000, "2026-10-09", 20000, 0)).toEqual({
      surplusPerMonthCents: 40000,
      months: 3,
      month: "2027-01",
    });
  });

  it("Sparziele gehen vom Überschuss ab", () => {
    expect(planPurchase(months, 120000, "2026-10-09", 20000, 20000)).toMatchObject({
      surplusPerMonthCents: 20000,
      months: 5,
      month: "2027-03",
    });
  });

  it("schon frei: jetzt; nichts übrig: kein Datum statt eines erfundenen", () => {
    expect(planPurchase(months, 10000, "2026-10-09", 20000, 0)).toMatchObject({ months: 0, month: "2026-10" });
    expect(planPurchase(months, 120000, "2026-10-09", 0, 50000)).toMatchObject({ months: null, month: null });
  });
});
