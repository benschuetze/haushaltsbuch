import { describe, expect, it } from "vitest";
import { computeInsights, type InsightInput } from "./compute";
import { detectRecurring, merchantKey, merchantOf, serviceGroupOf } from "./recurring";

type B = InsightInput["bookings"][number];
const b = (date: string, cents: number, counterparty: string, category: string | null, purpose = ""): B => ({
  bookingDate: date,
  amountCents: cents,
  counterparty,
  purpose,
  categoryName: category,
  categoryId: category ? `id-${category}` : null,
  categoryKind: category === "Einkommen" ? "income" : category === "Umbuchung" ? "transfer" : "expense",
});
const monthly = (counterparty: string, cents: number[], category: string, startMonth = 3, day = "05") =>
  cents.map((c, i) => b(`2026-${String(startMonth + i).padStart(2, "0")}-${day}`, c, counterparty, category));

describe("detectRecurring", () => {
  it("nach einer Preiserhöhung bleibt ein Abo ein fester, planbarer Betrag; ständig andere Beträge nicht", () => {
    const rows = [
      ...monthly("Spotify AB", [-1099, -1099, -1099, -1199], "Abos & Verträge"),
      ...monthly("Aral Station", [-5820, -6390, -5510, -6100], "Mobilität"),
    ];
    const found = detectRecurring(rows, "2026-06-20");
    expect(found.find((r) => r.merchant === "Spotify AB")?.stable).toBe(true);
    expect(found.find((r) => r.merchant === "Aral Station")?.stable ?? false).toBe(false);
  });

  it("erkennt ein Monatsabo mit Jahreskosten und Preiserhöhung", () => {
    const [spotify] = detectRecurring(
      monthly("Spotify AB", [-999, -999, -999, -1099], "Abos & Verträge"),
      "2026-06-20",
    );
    expect(spotify).toMatchObject({
      merchant: "Spotify AB",
      cadence: "monthly",
      lastAmountCents: -1099,
      previousAmountCents: -999,
      yearlyCents: 13188,
      active: true,
      kind: "subscription",
    });
  });

  it("zwei gleiche Einkäufe im Monatsabstand sind Zufall, kein Abo", () => {
    const rows = [
      ...monthly("Bäckerei Kern", [-840, -840], "Lebensmittel"),
      ...monthly("Zoo Beispielstadt", [-2400, -2400], "Freizeit"),
    ];
    expect(detectRecurring(rows, "2026-05-10")).toEqual([]);
  });

  it("bekannte Dienste und die Abo-Kategorie reichen schon mit zwei Zahlungen", () => {
    const rows = [
      ...monthly("Netflix", [-1399, -1399], "Freizeit"),
      ...monthly("Kleiner Dienst", [-499, -499], "Abos & Verträge"),
    ];
    expect(
      detectRecurring(rows, "2026-05-10")
        .map((r) => r.merchant)
        .sort(),
    ).toEqual(["Kleiner Dienst", "Netflix"]);
  });

  it("Lebensmittel und Umbuchungen sind nie Abos, auch wenn sie regelmäßig sind", () => {
    const rows = [
      ...monthly("REWE Markt", [-5000, -5000, -5000], "Lebensmittel"),
      ...monthly("Tagesgeld", [-30000, -30000, -30000], "Umbuchung"),
    ];
    expect(detectRecurring(rows, "2026-06-01")).toEqual([]);
  });

  it("stark schwankende Beträge sind kein Abo", () => {
    expect(detectRecurring(monthly("Amazon", [-1200, -8900, -2300], "Sonstiges"), "2026-06-01")).toEqual([]);
  });

  it("Miete ist Fixkosten, kein kündbares Abo", () => {
    expect(detectRecurring(monthly("Hausverwaltung", [-89000, -89000, -89000], "Wohnen"), "2026-06-01")[0]?.kind).toBe(
      "fixed",
    );
  });

  it("gilt als beendet, wenn die letzte Zahlung lange her ist", () => {
    expect(detectRecurring(monthly("Netflix", [-1399, -1399, -1399], "Abos & Verträge"), "2026-10-01")[0]?.active).toBe(
      false,
    );
  });

  it("PayPal-Zahlungen werden nach dem Händler im Verwendungszweck gruppiert", () => {
    expect(
      merchantOf({ counterparty: "PayPal Europe", purpose: "PP.4471.PP . Disney Plus, Ihr Einkauf bei Disney" }),
    ).toBe("Disney Plus");
    expect(merchantKey("Spotify AB")).toBe(merchantKey("SPOTIFY"));
    expect(serviceGroupOf("Disney Plus")).toBe("Video-Streaming");
  });
});

describe("computeInsights", () => {
  const base: Omit<InsightInput, "bookings"> = { budgets: [], month: "2026-06", dayOfMonth: null, daysInMonth: 30 };

  it("Budget überschritten, mit Betrag und Prozent", () => {
    const drafts = computeInsights({
      ...base,
      bookings: [b("2026-06-03", -30000, "REWE", "Lebensmittel"), b("2026-06-20", -21000, "Lidl", "Lebensmittel")],
      budgets: [{ categoryId: "id-Lebensmittel", categoryName: "Lebensmittel", amountCents: 45000 }],
    });
    expect(drafts).toContainEqual(
      expect.objectContaining({ kind: "budget_exceeded", body: "510 € von 450 € ausgegeben (113 %), 60 € drüber." }),
    );
  });

  it("feste Abos werden nicht hochgerechnet: 3 Abos am 11. sind schon der ganze Monat", () => {
    // Three monthly subscriptions, all paid by the 11th: 10,99 + 13,99 + 9,99 = 34,97 €.
    // Linear would say 34,97 / 11 × 30 = 95,37 € and warn; really the month ends at 34,97 €.
    const abos = [
      ...monthly("Spotify AB", [-1099, -1099, -1099, -1099], "Abos & Verträge", 3, "05"),
      ...monthly("Netflix", [-1399, -1399, -1399, -1399], "Abos & Verträge", 3, "07"),
      ...monthly("Disney Plus", [-999, -999, -999, -999], "Abos & Verträge", 3, "09"),
    ];
    const drafts = computeInsights({
      ...base,
      dayOfMonth: 11,
      bookings: abos,
      budgets: [{ categoryId: "id-Abos & Verträge", categoryName: "Abos & Verträge", amountCents: 5000 }],
    });
    expect(drafts.find((d) => d.kind === "budget_warning")).toBeUndefined();
  });

  it("feste Kosten plus hochgerechneter Rest: der variable Teil zählt weiter", () => {
    // Fixed 10,99 € (paid) + variable 60 € by the 10th → 10,99 + 60 / 10 × 30 = 190,99 € over a 150 € budget.
    const drafts = computeInsights({
      ...base,
      dayOfMonth: 10,
      bookings: [
        ...monthly("Spotify AB", [-1099, -1099, -1099, -1099], "Hobbys", 3, "05"),
        b("2026-06-08", -6000, "Thomann", "Hobbys"),
      ],
      budgets: [{ categoryId: "id-Hobbys", categoryName: "Hobbys", amountCents: 15000 }],
    });
    expect(drafts.find((d) => d.kind === "budget_warning")?.body).toContain("etwa 190,99 €");
  });

  it("Hochrechnung warnt im laufenden Monat, bevor das Budget gerissen ist", () => {
    const drafts = computeInsights({
      ...base,
      dayOfMonth: 10,
      bookings: [b("2026-06-08", -20000, "REWE", "Lebensmittel")],
      budgets: [{ categoryId: "id-Lebensmittel", categoryName: "Lebensmittel", amountCents: 45000 }],
    });
    expect(drafts.find((d) => d.kind === "budget_warning")?.body).toContain("etwa 600 €");
  });

  it("vor dem 7. des Monats keine Hochrechnung, das wäre zu zufällig", () => {
    const drafts = computeInsights({
      ...base,
      dayOfMonth: 3,
      bookings: [b("2026-06-02", -20000, "REWE", "Lebensmittel")],
      budgets: [{ categoryId: "id-Lebensmittel", categoryName: "Lebensmittel", amountCents: 45000 }],
    });
    expect(drafts.filter((d) => d.kind.startsWith("budget"))).toEqual([]);
  });

  it("doppelte Streamingdienste mit Sparpotenzial des günstigeren", () => {
    const drafts = computeInsights({
      ...base,
      bookings: [
        ...monthly("Netflix", [-1399, -1399, -1399, -1399], "Abos & Verträge"),
        ...monthly("Disney Plus", [-899, -899, -899, -899], "Abos & Verträge"),
      ],
    });
    expect(drafts.find((d) => d.kind === "duplicate_service")).toMatchObject({
      title: "2× Video-Streaming",
      savingsCentsPerYear: 10788,
    });
    // One hint for all subscriptions instead of one each; cancelling one by one happens on /abos.
    const abos = drafts.filter((d) => d.kind === "subscription_found");
    expect(abos.map((d) => d.title)).toEqual(["2 Abos erkannt"]);
    expect(abos[0]?.body).toContain("Netflix, Disney Plus");
  });

  it("Preiserhöhung im betrachteten Monat mit Mehrkosten pro Jahr", () => {
    const drafts = computeInsights({
      ...base,
      bookings: monthly("Spotify AB", [-999, -999, -999, -1099], "Abos & Verträge"),
    });
    // Extra cost per year in the text, but not counted as savings: paying more is not money one could save.
    const increase = drafts.find((d) => d.kind === "price_increase");
    expect(increase).toMatchObject({ savingsCentsPerYear: null });
    expect(increase?.body).toContain("12 € mehr im Jahr");
  });

  it("Ausreißer gegenüber den Vormonaten, kleine Schwankungen nicht", () => {
    const rows = [
      b("2026-03-10", -10000, "Kino", "Freizeit"),
      b("2026-04-10", -10000, "Kino", "Freizeit"),
      b("2026-05-10", -10000, "Kino", "Freizeit"),
      b("2026-06-10", -25000, "Konzert", "Freizeit"),
      b("2026-03-11", -4000, "Apotheke", "Gesundheit"),
      b("2026-04-11", -4000, "Apotheke", "Gesundheit"),
      b("2026-06-11", -6000, "Apotheke", "Gesundheit"),
    ];
    const spikes = computeInsights({ ...base, bookings: rows }).filter((d) => d.kind === "spending_spike");
    expect(spikes.map((s) => s.title)).toEqual(["Mehr als sonst für Freizeit"]);
  });

  it("eine einzelne Ausgabe in drei Monaten ist kein Schnitt: kein Ausreißer-Hinweis", () => {
    const rows = [
      ...["03", "04", "05", "06"].map((m) => b(`2026-${m}-02`, -6000, "REWE", "Lebensmittel")),
      b("2026-03-20", -3150, "Lieferando", "Restaurant & Lieferdienst"),
      b("2026-06-05", -12940, "Lieferando", "Restaurant & Lieferdienst"),
    ];
    const spikes = computeInsights({ ...base, bookings: rows }).filter((d) => d.kind === "spending_spike");
    expect(spikes).toEqual([]);
  });

  it("weit über dem Schnitt: Euro-Unterschied statt dreistelliger Prozentzahl", () => {
    const rows = ["03", "04", "05"].map((m) => b(`2026-${m}-10`, -10000, "Kino", "Freizeit"));
    rows.push(b("2026-06-10", -40000, "Festival", "Freizeit"));
    const [spike] = computeInsights({ ...base, bookings: rows }).filter((d) => d.kind === "spending_spike");
    expect(spike?.body).toBe("400 € in diesem Monat, sonst im Schnitt 100 €: 300 € mehr.");
  });

  it("Bankgebühren werden aufs Jahr hochgerechnet", () => {
    const drafts = computeInsights({
      ...base,
      bookings: [
        b("2026-06-30", -695, "Sparkasse", null, "Kontoführungsentgelt 06/2026"),
        b("2026-06-15", -150, "Sparkasse", null, "Auslandseinsatzentgelt"),
      ],
    });
    expect(drafts.find((d) => d.kind === "fees")).toMatchObject({
      title: "8,45 € Bankgebühren diesen Monat",
      savingsCentsPerYear: 10140,
    });
  });
});
