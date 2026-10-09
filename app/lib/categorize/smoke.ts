import { generateText, isStepCount, type LanguageModel, tool } from "ai";
import { z } from "zod";
import { DEFAULT_CATEGORIES } from "~/lib/db/seed";
import { readTable } from "~/lib/import/formats/generic";
import { guessMappingWithLlm } from "~/lib/import/formats/llm-mapping";
import { categorizeWithLlm } from "./llm";

// Invented, tiny inputs: a few hundred tokens per deploy, fractions of a cent.
const SAMPLE_BOOKING = {
  id: "smoke",
  counterparty: "REWE Markt",
  purpose: "Kartenzahlung girocard",
  amountCents: -4510,
  bookingDate: "2026-09-04",
};
const SAMPLE_EXPORT =
  "Txn Dt;Ccy;Amt;Ctpy;Memo\n2026-09-08;EUR;-29.90;Fitnessstudio;Beitrag\n2026-09-21;EUR;80.00;Flohmarkt;Verkauf\n";

/**
 * Exercises both real LLM paths the way production uses them. Returns the problems found, empty when fine.
 * Mocks prove our handling of answers; only this proves key, workspace, model id and output format work.
 */
export async function aiSmokeTest(model: LanguageModel, assistantModel: LanguageModel = model): Promise<string[]> {
  const problems: string[] = [];
  const errors: unknown[] = [];
  const categories = DEFAULT_CATEGORIES.map((c) => ({ id: c.name, name: c.name, kind: c.kind }));

  const verdicts = await categorizeWithLlm(model, categories, [SAMPLE_BOOKING], (e) => errors.push(e));
  const verdict = verdicts.get("smoke");
  if (errors.length > 0) problems.push(`Kategorisierung: ${describe(errors[0])}`);
  else if (!verdict?.categoryId) problems.push("Kategorisierung: Antwort ohne gültige Kategorie");

  const table = readTable(new TextEncoder().encode(SAMPLE_EXPORT));
  const before = errors.length;
  const mapping = table ? await guessMappingWithLlm(model, table, (e) => errors.push(e)) : null;
  if (errors.length > before) problems.push(`Spaltenzuordnung: ${describe(errors[before])}`);
  else if (!mapping) problems.push("Spaltenzuordnung: keine gültige Zuordnung");

  // The assistant relies on tool calling, a different API path; a harmless tool, no data involved.
  try {
    const r = await generateText({
      model: assistantModel,
      system: "Antworte knapp auf Deutsch.",
      prompt: "Rufe das Werkzeug pruefzahl auf und nenne die Zahl, die es liefert.",
      tools: {
        pruefzahl: tool({
          description: "Liefert eine Prüfzahl.",
          inputSchema: z.object({}),
          execute: async () => ({ zahl: 4711 }),
        }),
      },
      stopWhen: isStepCount(3),
      maxOutputTokens: 200,
      maxRetries: 1,
    });
    const called = r.steps.some((s) => s.toolCalls.some((c) => c.toolName === "pruefzahl"));
    if (!called) problems.push("Assistent: Werkzeug wurde nicht aufgerufen");
    else if (!r.text.includes("4711")) problems.push("Assistent: Antwort nutzt das Werkzeug-Ergebnis nicht");
  } catch (error) {
    problems.push(`Assistent: ${describe(error)}`);
  }

  return problems;
}

function describe(error: unknown): string {
  if (error && typeof error === "object" && "responseBody" in error && typeof error.responseBody === "string") {
    return error.responseBody;
  }
  return error instanceof Error ? error.message : String(error);
}
