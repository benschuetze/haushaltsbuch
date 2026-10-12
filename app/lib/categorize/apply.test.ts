import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { takeFromDailyBudget } from "~/lib/daily-budget.server";
import type { Db } from "~/lib/db/client";
import { accounts, categories, rules, transactions } from "~/lib/db/schema";
import { importCsv } from "~/lib/import/run";
import { createTestDb } from "../../../tests/helpers/db";
import { scriptedModel } from "../../../tests/helpers/models";
import {
  categorizeOpen,
  categorizeTransactions,
  confirmTransaction,
  LLM_DAILY_ITEMS,
  reapplyRules,
  setManualCategory,
} from "./apply";
import { PROMPT_VERSION } from "./llm";

const demoCsv = new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv"));
let db: Db;
let accountId: string;
let cat: Record<string, string>;

/** Answers every transaction with the same category, so we can tell what the model touched. */
function modelSaying(category: string, confidence = 0.9) {
  return scriptedModel((call) => {
    const refs = [...JSON.stringify(call.prompt).matchAll(/\\"ref\\":\\"(t\d+)\\"/g)].map((m) => m[1]);
    return JSON.stringify({ results: refs.map((ref) => ({ ref, category, confidence })) });
  });
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  const [account] = await db.select().from(accounts);
  if (!account) throw new Error("Demo-Konto fehlt");
  accountId = account.id;
  cat = Object.fromEntries((await db.select().from(categories)).map((c) => [c.name, c.id]));
});

async function txBy(counterparty: string) {
  return db.select().from(transactions).where(eq(transactions.counterparty, counterparty));
}

describe("Kategorisierung in der Datenbank", () => {
  it("Regel schlägt LLM: Treffer einer Regel gehen gar nicht erst an das Modell", async () => {
    await db
      .insert(rules)
      .values({ field: "counterparty", matchType: "contains", pattern: "rewe", categoryId: cat.Haushalt as string });
    const { model, calls } = modelSaying("Sonstiges");
    const result = await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    const rewe = await txBy("REWE Markt");
    expect(rewe.every((t) => t.categoryId === cat.Haushalt && t.categorySource === "rule")).toBe(true);
    expect(JSON.stringify(calls.map((c) => c.prompt))).not.toContain("REWE");
    expect(result.byRule).toBeGreaterThanOrEqual(rewe.length);
  });

  it("höhere Priorität schlägt niedrigere", async () => {
    await db.insert(rules).values([
      {
        field: "counterparty",
        matchType: "contains",
        pattern: "paypal",
        categoryId: cat.Sonstiges as string,
        priority: 0,
      },
      {
        field: "purpose",
        matchType: "contains",
        pattern: "thomann",
        categoryId: cat.Hobbys as string,
        priority: 5,
      },
    ]);
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model: null });
    const paypal = await txBy("PayPal Europe");
    const thomann = paypal.filter((t) => t.purpose.includes("Thomann"));
    const zalando = paypal.filter((t) => t.purpose.includes("Zalando"));
    expect(thomann.every((t) => t.categoryId === cat.Hobbys)).toBe(true);
    expect(zalando.every((t) => t.categoryId === cat.Sonstiges)).toBe(true);
  });

  it("manuell gesetzte Kategorie wird weder von Regeln noch vom LLM überschrieben", async () => {
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model: null });
    const [spotify] = await txBy("Spotify AB");
    if (!spotify) throw new Error("Spotify fehlt");
    await setManualCategory(db, spotify.id, cat.Freizeit as string);

    await db.insert(rules).values({
      field: "counterparty",
      matchType: "contains",
      pattern: "spotify",
      categoryId: cat["Abos & Verträge"] as string,
    });
    await reapplyRules(db);
    const { model } = modelSaying("Sonstiges");
    await categorizeTransactions(db, [spotify.id], model);

    const [after] = await db.select().from(transactions).where(eq(transactions.id, spotify.id));
    expect(after).toMatchObject({ categoryId: cat.Freizeit, categorySource: "manual", needsReview: false });
  });

  it("neue Regel kategorisiert alle passenden Buchungen um, manuelle bleiben", async () => {
    const { model } = modelSaying("Sonstiges", 0.5);
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    const [first, second] = await txBy("Spotify AB");
    if (!first || !second) throw new Error("Spotify fehlt");
    await setManualCategory(db, first.id, cat.Freizeit as string);

    await db.insert(rules).values({
      field: "counterparty",
      matchType: "equals",
      pattern: "Spotify AB",
      categoryId: cat.Hobbys as string,
    });
    expect(await reapplyRules(db)).toBe(1);

    const after = Object.fromEntries((await txBy("Spotify AB")).map((t) => [t.id, t]));
    expect(after[first.id]).toMatchObject({ categoryId: cat.Freizeit, categorySource: "manual" });
    expect(after[second.id]).toMatchObject({
      categoryId: cat.Hobbys,
      categorySource: "rule",
      needsReview: false,
    });
  });

  it("LLM unter 0,7 Konfidenz: Kategorie als Vorschlag, aber in „prüfen“", async () => {
    const { model } = modelSaying("Lebensmittel", 0.6);
    const result = await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    expect(result.byAi).toBe(0);
    expect(result.needsReview).toBeGreaterThan(0);
    // A merchant the built-in list does not know, so it is the model's call.
    const [club] = await txBy("Club Hafen");
    expect(club).toMatchObject({ categoryId: cat.Lebensmittel, categorySource: "ai", needsReview: true });
    expect(club?.aiConfidence).toBeCloseTo(0.6);
  });

  it("Bestätigen nimmt die Buchung aus „prüfen“ und schützt sie vor späteren Regeln", async () => {
    const { model } = modelSaying("Lebensmittel", 0.6);
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    const [rewe] = await txBy("REWE Markt");
    if (!rewe) throw new Error("REWE fehlt");
    await confirmTransaction(db, rewe.id);
    await db
      .insert(rules)
      .values({ field: "counterparty", matchType: "contains", pattern: "rewe", categoryId: cat.Haushalt as string });
    await reapplyRules(db);
    const [after] = await db.select().from(transactions).where(eq(transactions.id, rewe.id));
    expect(after).toMatchObject({ categoryId: cat.Lebensmittel, categorySource: "manual", needsReview: false });
  });
});

describe("eingebaute Händlerliste", () => {
  it("bekannte Händler bekommen ihre Kategorie ohne Modell, unbekannte gehen weiter an die KI", async () => {
    const { model, calls } = modelSaying("Sonstiges");
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    const spotify = await txBy("Spotify AB");
    expect(spotify.every((t) => t.categoryId === cat["Abos & Verträge"] && t.categorySource === "rule")).toBe(true);
    expect((await txBy("ALDI SUED")).every((t) => t.categoryId === cat.Lebensmittel)).toBe(true);
    const asked = JSON.stringify(calls.map((c) => c.prompt));
    expect(asked).not.toContain("Spotify");
    expect(asked).toContain("Club Hafen");
  });

  it("eine eigene Regel schlägt die eingebaute Liste", async () => {
    await db
      .insert(rules)
      .values({ field: "counterparty", matchType: "contains", pattern: "spotify", categoryId: cat.Hobbys as string });
    const { model } = modelSaying("Sonstiges");
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    expect((await txBy("Spotify AB")).every((t) => t.categoryId === cat.Hobbys)).toBe(true);
  });

  it("schon falsch von der KI zugeordnete Buchungen werden korrigiert, manuelle nicht", async () => {
    const { model } = modelSaying("Sonstiges");
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    const [first, second] = await txBy("Spotify AB");
    if (!first || !second) throw new Error("Spotify fehlt");
    // As an older version left it: the model's guess, and one the user set by hand.
    await db
      .update(transactions)
      .set({ categoryId: cat.Sonstiges as string, categorySource: "ai", aiConfidence: 0.4, needsReview: true })
      .where(eq(transactions.id, first.id));
    await setManualCategory(db, second.id, cat.Freizeit as string);
    await reapplyRules(db);
    const after = Object.fromEntries((await txBy("Spotify AB")).map((t) => [t.id, t]));
    expect(after[first.id]).toMatchObject({
      categoryId: cat["Abos & Verträge"],
      categorySource: "rule",
      needsReview: false,
    });
    expect(after[second.id]).toMatchObject({ categoryId: cat.Freizeit, categorySource: "manual" });
  });
});

describe("Kosten-Deckel", () => {
  it("über dem Tagesbudget gehen Buchungen ohne Modellaufruf in „prüfen“ statt das Guthaben zu leeren", async () => {
    // Almost all of today's budget is already used: only 3 bookings may still go to the model.
    await takeFromDailyBudget(db, "llm_items", LLM_DAILY_ITEMS - 3, LLM_DAILY_ITEMS);
    const { model, calls } = modelSaying("Sonstiges");
    const result = await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    const asked = [...JSON.stringify(calls.map((c) => c.prompt)).matchAll(/\\"ref\\":/g)].length;
    expect(asked).toBe(3);
    expect(result.byAi).toBe(3);
    const open = await db.select().from(transactions).where(eq(transactions.needsReview, true));
    expect(open.length).toBe(result.needsReview);
    expect(result.needsReview).toBeGreaterThan(0);
  });
});

describe("offene Buchungen nachträglich zuordnen", () => {
  it("ordnet Buchungen ohne Kategorie zu, lässt zugeordnete und manuelle in Ruhe", async () => {
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model: null });
    const [spotify] = await txBy("Spotify AB");
    if (!spotify) throw new Error("Spotify fehlt");
    await setManualCategory(db, spotify.id, cat.Freizeit as string);

    const { model, calls } = modelSaying("Lebensmittel", 0.9);
    const stats = await categorizeOpen(db, model);
    expect(stats.open).toBeGreaterThan(0);
    expect(stats).toMatchObject({ byAi: stats.open, needsReview: 0 });
    const [after] = await db.select().from(transactions).where(eq(transactions.id, spotify.id));
    expect(after).toMatchObject({ categoryId: cat.Freizeit, categorySource: "manual" });

    // A second run finds nothing open and calls nothing.
    const again = await categorizeOpen(db, model);
    expect(again.open).toBe(0);
    expect(calls.length).toBe(Math.ceil(stats.open / 25));
  });

  it("ein Eingang, den früher die Händlerliste als Ausgabe einsortiert hat, kommt nach „prüfen“", async () => {
    // An older version filed a pension under "Versicherungen" because of the word in the name.
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model: null });
    const [salary] = await txBy("Arbeitgeber Muster GmbH");
    if (!salary) throw new Error("Gehalt fehlt");
    await db
      .update(transactions)
      .set({ counterparty: "Deutsche Rentenversicherung", categoryId: cat.Versicherungen, categorySource: "rule" })
      .where(eq(transactions.id, salary.id));
    await reapplyRules(db);
    const [after] = await db.select().from(transactions).where(eq(transactions.id, salary.id));
    expect(after).toMatchObject({ categoryId: null, needsReview: true });
  });

  it("jede KI-Entscheidung trägt Prompt-Version und Modell, Regel-Treffer nicht", async () => {
    const { model } = modelSaying("Freizeit", 0.9);
    await importCsv(db, { accountId, filename: "d.csv", bytes: demoCsv, model });
    const [club] = await txBy("Club Hafen");
    expect(club).toMatchObject({ categorySource: "ai", aiPromptVersion: PROMPT_VERSION, aiModel: "mock-model-id" });
    const [rewe] = await txBy("REWE Markt");
    expect(rewe).toMatchObject({ categorySource: "rule", aiPromptVersion: null, aiModel: null });
  });
});
