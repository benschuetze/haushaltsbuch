import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { failingModel, promptText, scriptedModel } from "../../../tests/helpers/models";
import { BATCH_SIZE, categorizeWithLlm, type LlmInput, redactIbans } from "./llm";

const categories = [
  { id: "cat-food", name: "Lebensmittel", kind: "expense" },
  { id: "cat-misc", name: "Sonstiges", kind: "expense" },
];
const item = (id: string, overrides: Partial<LlmInput> = {}): LlmInput => ({
  id,
  counterparty: "REWE Markt",
  purpose: "Kartenzahlung girocard",
  amountCents: -4510,
  bookingDate: "2026-08-04",
  ...overrides,
});
const answer = (results: object[]) => JSON.stringify({ results });

describe("categorizeWithLlm", () => {
  it("übernimmt sichere Antworten, unter 0,7 Konfidenz geht es in „prüfen“", async () => {
    const { model } = scriptedModel(
      answer([
        { ref: "t1", category: "Lebensmittel", confidence: 0.95 },
        { ref: "t2", category: "Sonstiges", confidence: 0.69 },
      ]),
    );
    const v = await categorizeWithLlm(model, categories, [item("a"), item("b")]);
    expect(v.get("a")).toEqual({ categoryId: "cat-food", confidence: 0.95, needsReview: false });
    expect(v.get("b")).toEqual({ categoryId: "cat-misc", confidence: 0.69, needsReview: true });
  });

  it("unbekannte Kategorie oder fehlende Buchung: Buchung bleibt, landet in „prüfen“ ohne Kategorie", async () => {
    const { model } = scriptedModel(answer([{ ref: "t1", category: "Urlaub", confidence: 0.99 }]));
    const v = await categorizeWithLlm(model, categories, [item("a"), item("b")]);
    expect(v.get("a")).toEqual({ categoryId: null, confidence: 0, needsReview: true });
    expect(v.get("b")).toEqual({ categoryId: null, confidence: 0, needsReview: true });
  });

  it("ungültiges JSON stürzt nicht ab, alle Buchungen landen in „prüfen“", async () => {
    const { model } = scriptedModel("Hier ist meine Antwort: {kaputt");
    const v = await categorizeWithLlm(model, categories, [item("a")]);
    expect(v.get("a")?.needsReview).toBe(true);
  });

  it("Modell nicht erreichbar: kein Absturz, alles in „prüfen“", async () => {
    const v = await categorizeWithLlm(failingModel(), categories, [item("a")]);
    expect(v.get("a")).toEqual({ categoryId: null, confidence: 0, needsReview: true });
  });

  it("Konfidenz außerhalb 0..1 wird begrenzt", async () => {
    const { model } = scriptedModel(answer([{ ref: "t1", category: "lebensmittel", confidence: 7 }]));
    const v = await categorizeWithLlm(model, categories, [item("a")]);
    expect(v.get("a")).toEqual({ categoryId: "cat-food", confidence: 1, needsReview: false });
  });

  it("schickt in Batches à 25", async () => {
    const { model, calls } = scriptedModel(answer([]));
    await categorizeWithLlm(
      model,
      categories,
      Array.from({ length: BATCH_SIZE * 2 + 1 }, (_, i) => item(`id-${i}`)),
    );
    expect(calls).toHaveLength(3);
  });

  it("an das Modell gehen nur Empfänger, Zweck, Betrag und Datum, keine IBAN und keine internen IDs", async () => {
    const { model, calls } = scriptedModel(answer([]));
    const withSecrets = {
      ...item("geheime-uuid-123"),
      raw: { IBAN: "DE89370400440532013000", Kontonummer: "0532013000" },
      iban: "DE89370400440532013000",
    };
    await categorizeWithLlm(model, categories, [withSecrets]);
    const sent = promptText(calls[0] as (typeof calls)[number]);
    expect(sent).toContain("REWE Markt");
    expect(sent).toContain("Kartenzahlung girocard");
    expect(sent).toContain("-45.10");
    expect(sent).toContain("2026-08-04");
    expect(sent).not.toContain("DE89");
    expect(sent).not.toContain("0532013000");
    expect(sent).not.toContain("geheime-uuid-123");
  });
});

describe("redactIbans", () => {
  it("schwärzt IBANs im Text, mit und ohne Leerzeichen", () => {
    expect(redactIbans("Empfänger: REWE Kto/IBAN: DE00200411110000000005 BLZ")).toBe(
      "Empfänger: REWE Kto/IBAN: [IBAN] BLZ",
    );
    expect(redactIbans("an DE89 3704 0044 0532 0130 00 danke")).toBe("an [IBAN] danke");
    expect(redactIbans("Rechnung 2026-0815")).toBe("Rechnung 2026-0815");
  });
});

describe("Kategorien im Prompt", () => {
  it("Standardkategorien kommen mit Beschreibung, eigene nur mit Namen", async () => {
    const { model, calls } = scriptedModel(answer([]));
    await categorizeWithLlm(
      model,
      [
        { id: "a", name: "Hobbys", kind: "expense" },
        { id: "b", name: "Einkommen", kind: "income" },
        { id: "c", name: "Garten", kind: "expense" },
      ],
      [item("x")],
    );
    const sent = promptText(calls[0] as (typeof calls)[number]);
    expect(sent).toContain("- Hobbys: Sport und Kurse");
    expect(sent).toContain("- Einkommen: nur Eingänge");
    // The prompt arrives JSON-encoded, so the line break is the two characters \ and n.
    expect(sent).toContain("- Garten\\n");
  });
});

describe("feste Kategorienliste und parallele Batches", () => {
  it("das Schema an das Modell nennt nur die erlaubten Kategorien", async () => {
    const { model, calls } = scriptedModel(answer([]));
    await categorizeWithLlm(model, categories, [item("x")]);
    const format = JSON.stringify(calls[0]?.responseFormat);
    expect(format).toContain('"enum":["Lebensmittel","Sonstiges"]');
  });

  it("ein unbekannter Name trifft nur seine Buchung, die anderen im Batch bleiben", async () => {
    const { model } = scriptedModel(
      answer([
        { ref: "t1", category: "Gibtsnicht", confidence: 0.9 },
        { ref: "t2", category: "Lebensmittel", confidence: 0.9 },
      ]),
    );
    const v = await categorizeWithLlm(model, categories, [item("a"), item("b")]);
    expect(v.get("a")).toMatchObject({ categoryId: null, needsReview: true });
    expect(v.get("b")).toMatchObject({ categoryId: "cat-food", needsReview: false });
  });

  it("höchstens drei Batches gleichzeitig, und alle kommen an", async () => {
    let running = 0;
    let peak = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return {
          content: [{ type: "text", text: answer([]) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 0, text: 0, reasoning: undefined },
          },
          warnings: [],
        };
      },
    });
    const items = Array.from({ length: BATCH_SIZE * 7 }, (_, i) => item(`i${i}`));
    const v = await categorizeWithLlm(model, categories, items);
    expect(v.size).toBe(items.length);
    expect(peak).toBe(3);
  });
});
