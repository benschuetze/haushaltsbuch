import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "~/lib/db/client";
import { accounts, categories, rules, transactions } from "~/lib/db/schema";
import { createTestDb } from "../../../tests/helpers/db";
import { failingModel, promptText, scriptedModel } from "../../../tests/helpers/models";
import { captureSpoken, counterpartyFrom } from "./run";

let db: Db;
let cat: Record<string, string>;
// 2026-10-21, noon in Berlin. A fixed clock keeps "heute" and "gestern" from depending on the day the suite runs.
const NOW = new Date("2026-10-21T10:00:00Z");

beforeEach(async () => {
  ({ db } = await createTestDb());
  cat = Object.fromEntries((await db.select().from(categories)).map((c) => [c.name, c.id]));
});

/** Answers every booking with the same category, like the model would. */
function modelSaying(category: string, confidence = 0.9) {
  return scriptedModel((call) => {
    const refs = [...promptText(call).matchAll(/\\"ref\\":\\"(t\d+)\\"/g)].map((m) => m[1]);
    return JSON.stringify({ results: refs.map((ref) => ({ ref, category, confidence })) });
  });
}

async function bookings() {
  return db.select().from(transactions).where(eq(transactions.source, "voice"));
}

describe("captureSpoken", () => {
  it("bucht „hab 7 Euro für Döner gezahlt“ als −700 im Konto Bar", async () => {
    const { model } = modelSaying("Restaurant & Lieferdienst");
    const result = await captureSpoken(db, { text: "hab 7 Euro für Döner gezahlt", key: "k1" }, { model, now: NOW });

    expect(result.created).toBe(true);
    const [row] = await bookings();
    expect(row).toMatchObject({
      amountCents: -700,
      bookingDate: "2026-10-21",
      source: "voice",
      captureText: "hab 7 Euro für Döner gezahlt",
      captureKey: "k1",
      importId: null,
      purpose: "",
    });
    expect(row?.counterparty).toBe("Döner");
    const [bar] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, row?.accountId ?? ""));
    expect(bar?.name).toBe("Bar");
  });

  it("legt das Konto Bar nur einmal an", async () => {
    await captureSpoken(db, { text: "3 Euro Kaffee", key: "a" }, { model: null, now: NOW });
    await captureSpoken(db, { text: "4 Euro Kuchen", key: "b" }, { model: null, now: NOW });
    expect(await db.$count(accounts, eq(accounts.name, "Bar"))).toBe(1);
  });

  it("derselbe Schlüssel bucht nur einmal und liefert die erste Buchung zurück", async () => {
    const first = await captureSpoken(db, { text: "7 Euro Döner", key: "same" }, { model: null, now: NOW });
    const again = await captureSpoken(db, { text: "9 Euro etwas anderes", key: "same" }, { model: null, now: NOW });

    expect(again.created).toBe(false);
    expect(again.transaction.id).toBe(first.transaction.id);
    expect(again.transaction.amountCents).toBe(-700);
    expect(await bookings()).toHaveLength(1);
  });

  describe("Datum", () => {
    it.each([
      ["7 Euro Döner", "2026-10-21"],
      ["gestern 7 Euro Döner", "2026-10-20"],
      ["7 Euro Döner von vorgestern", "2026-10-19"],
    ])("„%s“ → %s", async (text, date) => {
      const { transaction } = await captureSpoken(db, { text, key: text }, { model: null, now: NOW });
      expect(transaction.bookingDate).toBe(date);
    });

    it("heute ist das Berliner Datum, nicht das UTC-Datum", async () => {
      const lateEvening = new Date("2026-10-20T23:30:00Z"); // 01:30 am 21 Oct in Berlin
      const { transaction } = await captureSpoken(
        db,
        { text: "2 Euro Brötchen", key: "t" },
        { model: null, now: lateEvening },
      );
      expect(transaction.bookingDate).toBe("2026-10-21");
    });

    it("„gestern“ gehört nicht zum Empfänger", async () => {
      const { transaction } = await captureSpoken(
        db,
        { text: "gestern 7 Euro Döner", key: "g" },
        { model: null, now: NOW },
      );
      expect(transaction.counterparty).toBe("Döner");
    });
  });

  describe("Kategorie", () => {
    it("eine Regel genügt, das Modell wird gar nicht gefragt", async () => {
      await db.insert(rules).values({
        field: "counterparty",
        matchType: "contains",
        pattern: "döner",
        categoryId: cat["Restaurant & Lieferdienst"] as string,
      });
      const { model, calls } = modelSaying("Sonstiges");
      const { transaction } = await captureSpoken(
        db,
        { text: "hab 7 Euro für Döner gezahlt", key: "r" },
        { model, now: NOW },
      );

      expect(calls).toHaveLength(0);
      expect(transaction).toMatchObject({
        categoryId: cat["Restaurant & Lieferdienst"],
        categorySource: "rule",
        needsReview: false,
      });
    });

    it("ohne Regel entscheidet das Modell, und es sieht nur Empfänger, Betrag und Datum", async () => {
      const { model, calls } = modelSaying("Restaurant & Lieferdienst");
      const { transaction } = await captureSpoken(
        db,
        { text: "hab 7 Euro für Döner gezahlt", key: "m" },
        { model, now: NOW },
      );

      expect(calls).toHaveLength(1);
      const prompt = promptText(calls[0] as never);
      expect(prompt).toContain('\\"counterparty\\":\\"Döner\\"');
      expect(prompt).not.toContain("hab 7 Euro für Döner gezahlt");
      expect(transaction).toMatchObject({
        categoryId: cat["Restaurant & Lieferdienst"],
        categorySource: "ai",
        needsReview: false,
      });
    });

    it("unsicheres Modell (Konfidenz unter 0,7): die Buchung landet in „prüfen“", async () => {
      const { model } = modelSaying("Freizeit", 0.4);
      const { transaction } = await captureSpoken(db, { text: "7 Euro Dings", key: "u" }, { model, now: NOW });
      expect(transaction.needsReview).toBe(true);
    });

    it("Modell fällt aus: Buchung ist gespeichert, ohne Kategorie und zum Prüfen", async () => {
      const { transaction } = await captureSpoken(
        db,
        { text: "hab 7 Euro für Döner gezahlt", key: "f" },
        { model: failingModel(), now: NOW },
      );

      expect(transaction).toMatchObject({ amountCents: -700, categoryId: null, needsReview: true });
      expect(await bookings()).toHaveLength(1);
    });

    it("ohne Modell (kein Schlüssel) ebenso zum Prüfen", async () => {
      const { transaction } = await captureSpoken(
        db,
        { text: "hab 7 Euro für Döner gezahlt", key: "n" },
        { model: null, now: NOW },
      );
      expect(transaction).toMatchObject({ categoryId: null, needsReview: true });
    });
  });

  describe("Betrag", () => {
    it("ohne Betrag entsteht ein Entwurf mit 0 € zum Prüfen, der Satz bleibt erhalten, das Modell wird nicht gefragt", async () => {
      const { model, calls } = modelSaying("Lebensmittel");
      const result = await captureSpoken(db, { text: "hab einen Döner gekauft", key: "d" }, { model, now: NOW });

      expect(result.draft).toBe(true);
      expect(result.transaction).toMatchObject({
        amountCents: 0,
        needsReview: true,
        source: "voice",
        captureText: "hab einen Döner gekauft",
      });
      expect(calls).toHaveLength(0);
    });

    it("unsicherer Betrag bleibt auf „prüfen“, auch wenn eine Regel die Kategorie kennt", async () => {
      await db.insert(rules).values({
        field: "counterparty",
        matchType: "contains",
        pattern: "döner",
        categoryId: cat["Restaurant & Lieferdienst"] as string,
      });
      const { transaction, draft } = await captureSpoken(
        db,
        { text: "Döner 7 Euro und Cola 2,50", key: "x" },
        { model: null, now: NOW },
      );
      expect(draft).toBe(false);
      expect(transaction).toMatchObject({ categoryId: cat["Restaurant & Lieferdienst"], needsReview: true });
    });

    it("ein unsinnig großer Betrag sprengt die Spalte nicht, er wird ein Entwurf", async () => {
      const { transaction, draft } = await captureSpoken(
        db,
        { text: "999999999 Euro Döner", key: "big" },
        { model: null, now: NOW },
      );
      expect(draft).toBe(true);
      expect(transaction.needsReview).toBe(true);
    });
  });

  it("kürzt den Empfänger auf 80 Zeichen", async () => {
    const { transaction } = await captureSpoken(
      db,
      { text: `5 Euro ${"Bäckerei ".repeat(20)}`, key: "long" },
      { model: null, now: NOW },
    );
    expect(transaction.counterparty.length).toBeLessThanOrEqual(80);
    expect(transaction.counterparty.startsWith("Bäckerei")).toBe(true);
  });
});

describe("counterpartyFrom", () => {
  it.each([
    ["hab grad 7€ für nen döner gezahlt", "Döner"],
    ["hab grad 7 Euro für nen Döner gezahlt", "Döner"],
    ["gerade beim Bäcker 3,20 ausgegeben", "Bäcker"],
    ["hab mir eben nen Kaffee für 3,50 gekauft", "Kaffee"],
    ["zwanzig Euro beim Friseur bezahlt", "Friseur"],
    ["12 Euro im Kino", "Kino"],
    ["Bäckerei am Markt 4 Euro", "Bäckerei am Markt"],
    ["7,50€ Pizza", "Pizza"],
    ["€7 Pizza", "Pizza"],
    ["gestern 5 Euro zum Bäcker", "Bäcker"],
    ["Kaffee bei Anna 3 Euro", "Kaffee bei Anna"],
  ])("„%s“ → „%s“", (text, payee) => {
    expect(counterpartyFrom(text)).toBe(payee);
  });

  it("gibt nie einen leeren Empfänger zurück", () => {
    // Only filler and amount: the sentence without the amount is better than nothing.
    expect(counterpartyFrom("hab grad 7€ gezahlt")).toBe("Hab grad gezahlt");
    expect(counterpartyFrom("7 Euro")).toBe("7 Euro");
  });
});
