import { describe, expect, it } from "vitest";
import { scriptedModel } from "../../../tests/helpers/models";
import { findCategory, parseRuleWish, previewRule, proposeRule } from "./rule-agent";

const CATS = [
  "Wohnen",
  "Lebensmittel",
  "Kind & Kita",
  "Abos & Verträge",
  "Hobbys",
  "Restaurant & Lieferdienst",
  "Umbuchung",
  "Sonstiges",
].map((name, i) => ({ id: `c${i}`, name }));
const id = (name: string) => CATS.find((c) => c.name === name)?.id;

describe("Regel-Wunsch ohne KI verstehen", () => {
  it.each([
    ["Lieferando ist immer Restaurant", "Lieferando", "Restaurant & Lieferdienst"],
    ["Alles von Thomann ist Hobby", "Thomann", "Hobbys"],
    ["Zahlungen an Netflix sind Abos", "Netflix", "Abos & Verträge"],
    ["„Spotify“ → Abos & Verträge", "Spotify", "Abos & Verträge"],
    ["Edeka gehört zu Lebensmittel.", "Edeka", "Lebensmittel"],
    ["Tagesgeld als Umbuchung", "Tagesgeld", "Umbuchung"],
  ])("„%s“", (text, pattern, category) => {
    expect(parseRuleWish(text, CATS)).toEqual([
      {
        field: "counterparty",
        matchType: "contains",
        pattern,
        categoryId: id(category),
        categoryName: category,
        source: "lokal",
      },
    ]);
  });

  it("„im Verwendungszweck“ macht eine Regel auf den Zweck", () => {
    expect(parseRuleWish("Alles mit Elternbeitrag im Verwendungszweck ist Kita", CATS)).toMatchObject([
      { field: "purpose", pattern: "Elternbeitrag", categoryId: id("Kind & Kita") },
    ]);
  });

  it("ohne erkennbare Kategorie oder Muster: kein geratener Vorschlag", () => {
    expect(parseRuleWish("mach mal irgendwas", CATS)).toEqual([]);
    expect(parseRuleWish("ab ist Hobbys", CATS)).toEqual([]);
    expect(parseRuleWish("Thomann ist Urlaub", CATS)).toEqual([]);
  });

  it("mehrere Händler in einem Satz werden mehrere Regeln; „H&M“ bleibt einer", () => {
    expect(parseRuleWish("Netflix und Spotify sind Abos", CATS).map((p) => p.pattern)).toEqual(["Netflix", "Spotify"]);
    expect(parseRuleWish("Aldi, Lidl oder Edeka ist Lebensmittel", CATS).map((p) => p.pattern)).toEqual([
      "Aldi",
      "Lidl",
      "Edeka",
    ]);
    expect(parseRuleWish("H&M ist Sonstiges", CATS).map((p) => p.pattern)).toEqual(["H&M"]);
  });

  it("Kategorie per Wortanfang: „Restaurant“ → „Restaurant & Lieferdienst“", () => {
    expect(findCategory("restaurant", CATS)?.name).toBe("Restaurant & Lieferdienst");
  });
});

describe("unklare Sätze gehen an die KI, Antwort wird geprüft", () => {
  it("lokal verstanden: kein Modellaufruf", async () => {
    const { model, calls } = scriptedModel(() => "{}");
    await proposeRule("Lieferando ist Restaurant", CATS, [], model);
    expect(calls).toHaveLength(0);
  });

  it("KI-Vorschlag mit gültiger Kategorie wird übernommen; ans Modell gehen nur passende Empfänger", async () => {
    const { model, calls } = scriptedModel(() =>
      JSON.stringify({
        understood: true,
        field: "counterparty",
        matchType: "contains",
        patterns: ["rewe"],
        category: "Lebensmittel",
      }),
    );
    const result = await proposeRule(
      "Den Supermarkt bei mir um die Ecke, also REWE, bitte unter Essen",
      CATS,
      ["REWE Markt GmbH", "Hausverwaltung Sonnenhof"],
      model,
    );
    expect(result).toMatchObject([{ pattern: "rewe", categoryId: id("Lebensmittel"), source: "ki" }]);
    const sent = JSON.stringify(calls[0]?.prompt);
    expect(sent).toContain("REWE Markt GmbH");
    expect(sent).not.toContain("Hausverwaltung");
  });

  it("eine abgeschnittene, unlesbare Antwort wird einmal neu angefragt", async () => {
    let call = 0;
    const { model, calls } = scriptedModel(() =>
      ++call === 1
        ? '{"understood": true, "field": "counterparty", "matchType": "cont'
        : JSON.stringify({
            understood: true,
            field: "counterparty",
            matchType: "contains",
            patterns: ["rewe"],
            category: "Lebensmittel",
          }),
    );
    const errors: unknown[] = [];
    const result = await proposeRule("Den Supermarkt REWE bitte unter Essen", CATS, [], model, (e) => errors.push(e));
    expect(calls).toHaveLength(2);
    expect(errors).toEqual([]);
    expect(result).toMatchObject([{ pattern: "rewe", categoryId: id("Lebensmittel") }]);
  });

  it("erfundene Kategorie oder „nicht verstanden“: kein Vorschlag", async () => {
    const invent = scriptedModel(() =>
      JSON.stringify({
        understood: true,
        field: "counterparty",
        matchType: "contains",
        pattern: "x y",
        category: "Urlaub",
      }),
    );
    expect(await proposeRule("irgendwas Komisches", CATS, [], invent.model)).toEqual([]);
    const unsure = scriptedModel(() =>
      JSON.stringify({ understood: false, field: "counterparty", matchType: "contains", patterns: [], category: "" }),
    );
    expect(await proposeRule("hä?", CATS, [], unsure.model)).toEqual([]);
  });
});

describe("Vorschau vor dem Übernehmen", () => {
  const bookings = [
    {
      counterparty: "Lieferando.de",
      purpose: "Bestellung",
      amountCents: -2890,
      bookingDate: "2026-10-02",
      categoryId: null,
      categorySource: null,
    },
    {
      counterparty: "LIEFERANDO",
      purpose: "Bestellung",
      amountCents: -3420,
      bookingDate: "2026-10-04",
      categoryId: id("Restaurant & Lieferdienst") ?? null,
      categorySource: "rule",
    },
    {
      counterparty: "Lieferando.de",
      purpose: "Bestellung",
      amountCents: -1500,
      bookingDate: "2026-09-01",
      categoryId: id("Sonstiges") ?? null,
      categorySource: "manual",
    },
    {
      counterparty: "REWE",
      purpose: "Karte",
      amountCents: -5000,
      bookingDate: "2026-10-03",
      categoryId: null,
      categorySource: null,
    },
  ];

  it("zählt Treffer und echte Änderungen; von Hand Gesetztes ändert sich nie", () => {
    const preview = previewRule(
      {
        field: "counterparty",
        matchType: "contains",
        pattern: "Lieferando",
        categoryId: id("Restaurant & Lieferdienst") ?? "",
      },
      bookings,
    );
    expect(preview.matches).toBe(3);
    expect(preview.changes).toBe(1);
    expect(preview.examples.map((e) => e.bookingDate)).toEqual(["2026-10-04", "2026-10-02", "2026-09-01"]);
    expect(preview.priority).toBe(0);
  });

  it("eine ältere, widersprechende Regel verliert: neue Regel liegt eine Priorität darüber, Vorschau rechnet damit", () => {
    const old = {
      field: "counterparty" as const,
      matchType: "contains" as const,
      pattern: "lieferando",
      categoryId: id("Sonstiges") ?? "",
      priority: 3,
      createdAt: new Date("2026-01-01"),
    };
    const unrelated = { ...old, pattern: "rewe", categoryId: id("Lebensmittel") ?? "", priority: 9 };
    const preview = previewRule(
      {
        field: "counterparty",
        matchType: "contains",
        pattern: "Lieferando",
        categoryId: id("Restaurant & Lieferdienst") ?? "",
      },
      bookings,
      [old, unrelated],
    );
    expect(preview.priority).toBe(4);
    expect(preview.changes).toBe(1);
  });
});
