import { describe, expect, it } from "vitest";
import { type LlmExample, pickExamples } from "./examples";

const ex = (counterparty: string, purpose: string, category: string): LlmExample => ({
  counterparty,
  purpose,
  amountCents: -1000,
  category,
});
const booking = (counterparty: string, purpose = "Kartenzahlung") => ({
  id: counterparty,
  counterparty,
  purpose,
  amountCents: -1000,
  bookingDate: "2026-10-01",
});

describe("ähnliche bestätigte Buchungen als Beispiele", () => {
  const pool = [
    ex("Boulderhalle Südwand", "10er Karte", "Hobbys"),
    ex("Kletterzentrum Ost", "Kletterhalle Eintritt", "Hobbys"),
    ex("REWE Markt", "Kartenzahlung girocard", "Lebensmittel"),
    ex("Stadtwerke", "Abschlag Strom", "Wohnen"),
  ];

  it("nimmt, was Wörter mit dem Batch teilt, das Ähnlichste zuerst", () => {
    const picked = pickExamples(pool, [booking("Kletterhalle Nordwand", "10er Karte")]);
    expect(picked.map((p) => p.counterparty)).toEqual(["Boulderhalle Südwand", "Kletterzentrum Ost"]);
  });

  it("Füllwörter wie „Kartenzahlung“ machen nichts ähnlich", () => {
    expect(pickExamples(pool, [booking("Kiosk Eck", "Kartenzahlung girocard")])).toEqual([]);
  });

  it("höchstens so viele wie erlaubt", () => {
    const many = Array.from({ length: 20 }, (_, i) => ex(`Kletterhalle ${i}`, "Karte", "Hobbys"));
    expect(pickExamples(many, [booking("Kletterhalle X")], 5)).toHaveLength(5);
  });
});
