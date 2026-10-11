import { describe, expect, it } from "vitest";
import { type AvailableBooking, addMonths, availableToSpend, canAfford } from "./available";

function b(
  date: string,
  counterparty: string,
  cents: number,
  kind: "income" | "expense" | "transfer" = "expense",
  categoryName: string | null = null,
): AvailableBooking {
  return { bookingDate: date, counterparty, purpose: "", amountCents: cents, categoryName, categoryKind: kind };
}

// Three months of a simple household. Hand-checked numbers for 9 October 2026:
// income since payday 1.10.: 3.000,00; spent so far: rent 900,00 + Spotify 10,99 + groceries 60,00 + 45,00 = 1.015,99
// next salary: 1.11.2026 is a Sunday, so it arrives Monday 2.11.; the period runs to 1.11.
// still due before then: Netflix Mo 12.10. 13,99 + savings Do 15.10. 300,00 = 313,99 (rent Sun 1.11. moves to 2.11.)
// free: 3.000,00 − 1.015,99 − 313,99 = 1.670,02; days 9.10.–1.11. = 24 → 69,5841, rounded down to 69,58 per day
const HOUSEHOLD: AvailableBooking[] = [];
for (const m of ["08", "09", "10"]) {
  HOUSEHOLD.push(
    b(`2026-${m}-01`, "Arbeitgeber Muster GmbH", 300000, "income", "Einkommen"),
    b(`2026-${m}-01`, "Hausverwaltung Sonnenhof", -90000, "expense", "Wohnen"),
    b(`2026-${m}-07`, "Spotify AB", -1099, "expense", "Abos & Software"),
  );
  if (m !== "10") {
    HOUSEHOLD.push(
      b(`2026-${m}-12`, "Netflix", -1399, "expense", "Abos & Software"),
      b(`2026-${m}-15`, "Eigenes Tagesgeld", -30000, "transfer", "Umbuchung"),
      b(`2026-${m}-20`, "REWE Markt", -8000, "expense", "Lebensmittel"),
    );
  }
}
HOUSEHOLD.push(
  b("2026-10-03", "REWE Markt", -6000, "expense", "Lebensmittel"),
  b("2026-10-08", "Lidl", -4500, "expense", "Lebensmittel"),
);

describe("Tagesbudget: wie viel ist heute drin?", () => {
  const a = availableToSpend(HOUSEHOLD, "2026-10-09");

  it("erkennt das Gehalt und den nächsten Zahltag", () => {
    expect(a.nextIncome).toEqual({ name: "Arbeitgeber Muster GmbH", date: "2026-11-02", amountCents: 300000 });
    expect(a).toMatchObject({ periodStart: "2026-10-01", periodEnd: "2026-11-01", daysLeft: 24 });
  });

  it("zieht Ausgeben und noch Fälliges ab, Sparrate inklusive, schon Bezahltes nicht doppelt", () => {
    expect(a.incomeCents).toBe(300000);
    expect(a.spentCents).toBe(101599);
    expect(a.upcoming).toEqual([
      { name: "Netflix", date: "2026-10-12", amountCents: 1399 },
      { name: "Eigenes Tagesgeld", date: "2026-10-15", amountCents: 30000 },
    ]);
    expect(a.freeCents).toBe(167002);
    expect(a.perDayCents).toBe(6958);
  });

  it("PayPal-Abbuchung und schwankende Beträge (Tanken) werden nicht als fällig vorhergesagt", () => {
    const extra = [
      ...HOUSEHOLD,
      b("2026-08-11", "Aral Station", -5820, "expense", "Mobilität"),
      b("2026-09-11", "Aral Station", -6390, "expense", "Mobilität"),
      b("2026-08-13", "PayPal Europe", -1399, "transfer", "Umbuchung"),
      b("2026-09-13", "PayPal Europe", -1399, "transfer", "Umbuchung"),
    ];
    const names = availableToSpend(extra, "2026-10-09").upcoming.map((u) => u.name);
    expect(names).toEqual(["Netflix", "Eigenes Tagesgeld"]);
  });

  it("ohne erkennbares Gehalt: Kalendermonat", () => {
    const noSalary = HOUSEHOLD.filter((x) => x.categoryKind !== "income");
    const r = availableToSpend(noSalary, "2026-10-09");
    expect(r).toMatchObject({ nextIncome: null, periodStart: "2026-10-01", periodEnd: "2026-10-31" });
    expect(r.perDayCents).toBe(0);
  });

  it("Gehalt ein paar Tage verspätet: der Zahltag bleibt, nicht einen Monat später", () => {
    const late = availableToSpend(HOUSEHOLD, "2026-11-03");
    // Due 1.11. (Sunday), so expected on Monday 2.11.
    expect(late.nextIncome?.date).toBe("2026-11-02");
  });

  it("Gehalt des laufenden Monats fehlt in den Buchungen: kein Topf aus zwei Monaten, Lücke wird gemeldet", () => {
    const withoutOctober = HOUSEHOLD.filter((x) => !(x.categoryKind === "income" && x.bookingDate === "2026-10-01"));
    const r = availableToSpend(withoutOctober, "2026-10-09");
    expect(r).toMatchObject({ periodStart: "2026-10-01", periodEnd: "2026-11-01" });
    expect(r.missingIncome).toEqual({ name: "Arbeitgeber Muster GmbH", date: "2026-10-01", amountCents: 300000 });
    expect(r.incomeCents).toBe(0);
    expect(a.missingIncome).toBeNull();
  });

  it("eine Abbuchung, die auf einen Sonntag fällt, kommt am Montag: heute (So) ist sie noch nicht weg", () => {
    const withPhone = [
      ...HOUSEHOLD,
      b("2026-08-11", "Telekom Deutschland", -3495, "expense", "Abos & Software"),
      b("2026-09-11", "Telekom Deutschland", -3495, "expense", "Abos & Software"),
    ];
    const r = availableToSpend(withPhone, "2026-10-11");
    expect(r.upcoming.find((u) => u.name === "Telekom Deutschland")).toEqual({
      name: "Telekom Deutschland",
      date: "2026-10-12",
      amountCents: 3495,
    });
  });

  it("Monatsende: 31. Januar plus ein Monat ist der 28. Februar", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("Kann ich mir das leisten?", () => {
  const a = availableToSpend(HOUSEHOLD, "2026-10-09");

  it("passt in den heutigen Anteil: locker", () => {
    expect(canAfford(a, 5000).verdict).toBe("locker");
  });

  it("kostet ein paar Tage, mehr als die Hälfte bleibt: geht", () => {
    const r = canAfford(a, 40000);
    expect(r.verdict).toBe("geht");
    expect(r.afterCents).toBe(127002);
    // 1.270,02 over 24 days = 52,9175 → 52,91
    expect(r.perDayAfterCents).toBe(5291);
  });

  it("bleibt knapp im Plus: knapp", () => {
    expect(canAfford(a, 150000).verdict).toBe("knapp");
  });

  it("geht ins Minus: nein", () => {
    expect(canAfford(a, 200000)).toMatchObject({ verdict: "nein", afterCents: -32998 });
  });
});
