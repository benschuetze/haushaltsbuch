import { describe, expect, it } from "vitest";
import type { AvailableBooking } from "./available";
import { mondayOf, weekReview } from "./week";

const b = (date: string, counterparty: string, cents: number, kind = "expense"): AvailableBooking => ({
  bookingDate: date,
  counterparty,
  purpose: "",
  amountCents: cents,
  categoryName: null,
  categoryKind: kind,
});

// Mondays: 7.9., 14.9., 21.9., 28.9., 5.10. — today Wednesday 7.10.
// Each earlier week: groceries Monday 50 € and Tuesday 30 € (80 € by Wednesday), Saturday 100 €.
// Rent 900 € on the 1st (fixed, stable) and a savings transfer never count.
function weeks(saturdayCents: number[]): AvailableBooking[] {
  const out: AvailableBooking[] = [];
  ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].forEach((monday, i) => {
    const day = (n: number) => new Date(Date.parse(monday) + n * 86_400_000).toISOString().slice(0, 10);
    out.push(b(day(0), "REWE", -5000), b(day(1), "Lidl", -3000), b(day(5), "Bar", -(saturdayCents[i] ?? 10000)));
  });
  for (const m of ["2026-08-01", "2026-09-01", "2026-10-01"]) {
    out.push(b(m, "Hausverwaltung", -90000), b(m, "Tagesgeld", -30000, "transfer"));
  }
  return out;
}

describe("Wochenrückblick", () => {
  it("Montag einer Woche, auch über den Monatswechsel", () => {
    expect(mondayOf("2026-10-07")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28");
  });

  it("Mittwoch: vergleicht Mo–Mi mit Mo–Mi der Vorwochen, ohne Miete und Sparrate", () => {
    const data = [
      ...weeks([10000, 10000, 10000, 10000]),
      b("2026-10-05", "REWE", -2000),
      b("2026-10-06", "Kino", -1500),
    ];
    const r = weekReview(data, "2026-10-07");
    expect(r).toMatchObject({ weekStart: "2026-10-05", spentCents: 3500, usualCents: 8000 });
  });

  it("Serie: abgeschlossene Wochen in Folge unter ihrem eigenen Schnitt", () => {
    // Saturdays 100, 100, 60, 40 € → week totals 180, 180, 140, 120: the last two each below the weeks before.
    const r = weekReview(weeks([10000, 10000, 6000, 4000]), "2026-10-07");
    expect(r.streakWeeks).toBe(2);
  });

  it("Woche ohne jede Buchung zählt als unbekannt, nicht als sparsam", () => {
    const data = weeks([10000, 10000, 10000, 10000]).filter(
      (x) => !(x.bookingDate >= "2026-09-14" && x.bookingDate <= "2026-09-20"),
    );
    const r = weekReview(data, "2026-10-07");
    expect(r.usualCents).toBe(8000);
  });

  it("zu wenig Verlauf: kein Vergleich statt eines erfundenen", () => {
    expect(weekReview([b("2026-10-05", "REWE", -2000)], "2026-10-07")).toMatchObject({
      usualCents: null,
      streakWeeks: 0,
    });
  });
});
