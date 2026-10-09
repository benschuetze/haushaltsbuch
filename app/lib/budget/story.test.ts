import { describe, expect, it } from "vitest";
import { monthStory, type StoryInput } from "./story";

const base: StoryInput = {
  month: "2026-09",
  incomeCents: 300000,
  expenseCents: -200000,
  categories: [
    { name: "Wohnen", cents: -90000 },
    { name: "Lebensmittel", cents: -40000 },
  ],
  previousExpenseCents: -230000,
  biggest: { counterparty: "Hausverwaltung", amountCents: -90000, date: "2026-09-01" },
  subscriptions: { count: 3, monthlyCents: 4500 },
  savedCents: 30000,
};

describe("Monatsrückblick", () => {
  it("erzählt den Monat in Karten, mit den richtigen Zahlen", () => {
    const cards = monthStory(base);
    expect(cards.map((c) => c.id)).toEqual(["summe", "kategorie", "groesste", "vergleich", "abos", "gespart"]);
    expect(cards[0]).toMatchObject({
      kicker: "September 2026",
      title: "2.000,00 € ausgegeben",
      note: "3.000,00 € kamen rein, 1.000,00 € blieben übrig.",
      tone: "good",
    });
    expect(cards[1]).toMatchObject({ title: "Wohnen", note: "900,00 €, das sind 45 % von allem." });
    expect(cards[2]).toMatchObject({ title: "900,00 €", note: "Hausverwaltung am 01.09.2026." });
    expect(cards[3]).toMatchObject({ title: "300,00 € weniger", tone: "good" });
  });

  it("mehr ausgegeben als eingenommen, mehr als im Vormonat: ehrlich rot", () => {
    const cards = monthStory({ ...base, expenseCents: -350000, previousExpenseCents: -300000 });
    expect(cards[0]).toMatchObject({ note: "3.000,00 € kamen rein, 500,00 € mehr raus als rein.", tone: "bad" });
    expect(cards.find((c) => c.id === "vergleich")).toMatchObject({ title: "500,00 € mehr", tone: "bad" });
  });

  it("ohne Vormonat, Abos und Gespartes: keine erfundenen Karten, Sparen als Anstoß", () => {
    const cards = monthStory({
      ...base,
      previousExpenseCents: null,
      subscriptions: { count: 0, monthlyCents: 0 },
      savedCents: 0,
    });
    expect(cards.map((c) => c.id)).toEqual(["summe", "kategorie", "groesste", "gespart"]);
    expect(cards.at(-1)).toMatchObject({ title: "Noch nichts" });
  });
});
