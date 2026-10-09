import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { safeError } from "~/lib/security.server";

export const REVIEW_THRESHOLD = 0.7;
export const BATCH_SIZE = 25;

/** Exactly what may leave the app. No IBAN, no account number, no raw CSV row. */
export type LlmInput = {
  id: string;
  counterparty: string;
  purpose: string;
  amountCents: number;
  bookingDate: string;
};

export type LlmCategory = { id: string; name: string; kind: string };

export type LlmVerdict = {
  categoryId: string | null;
  confidence: number;
  needsReview: boolean;
};

const responseSchema = z.object({
  results: z.array(
    z.object({
      ref: z.string(),
      category: z.string(),
      confidence: z.number(),
    }),
  ),
});

export const SYSTEM_PROMPT = `Du ordnest Kontobewegungen eines Privathaushalts in Deutschland Kategorien zu.
Regeln:
- Verwende ausschließlich einen Kategorienamen aus der übergebenen Liste, exakt so geschrieben.
- Positive Beträge sind Eingänge, negative sind Ausgaben.
- "Umbuchung" nur für Geld zwischen eigenen Konten (Sparrate, Tagesgeld, Depot-Überträge).
- Bei PayPal oder Sammelzahlern entscheidet der Händler im Verwendungszweck.
- Wenn die Zuordnung unklar ist (z. B. Versandhändler mit gemischtem Sortiment, Bargeld, Überweisungen an Privatpersonen), nimm "Sonstiges" und eine Konfidenz unter 0.5.
- confidence ist eine Zahl zwischen 0 und 1: wie sicher du bist.
- Gib für jede Buchung genau ein Ergebnis mit ihrer ref zurück.`;

// Real purposes often carry IBANs ("Kto/IBAN: DE…"). They never help categorising and must not leave the app.
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g;

export function redactIbans(text: string): string {
  return text.replace(IBAN_IN_TEXT, "[IBAN]");
}

export function buildPrompt(categories: LlmCategory[], items: LlmInput[]): string {
  const lines = items.map((item, i) =>
    JSON.stringify({
      ref: `t${i + 1}`,
      counterparty: redactIbans(item.counterparty),
      purpose: redactIbans(item.purpose),
      amount: (item.amountCents / 100).toFixed(2),
      date: item.bookingDate,
    }),
  );
  return `Kategorien:\n${categories.map((c) => `- ${c.name}`).join("\n")}\n\nBuchungen (eine pro Zeile, JSON):\n${lines.join("\n")}`;
}

const reviewOnly: LlmVerdict = { categoryId: null, confidence: 0, needsReview: true };

/**
 * Never throws for model problems: anything unusable (bad JSON, unknown category, missing entry) becomes
 * "needs review" for exactly the affected transactions, so an import never fails because the model did.
 */
export async function categorizeWithLlm(
  model: LanguageModel,
  categories: LlmCategory[],
  items: LlmInput[],
  onError: (error: unknown) => void = (error) =>
    console.error(`LLM-Kategorisierung fehlgeschlagen, Batch landet in „prüfen“: ${safeError(error)}`),
): Promise<Map<string, LlmVerdict>> {
  const verdicts = new Map<string, LlmVerdict>();
  const byName = new Map(categories.map((c) => [c.name.toLocaleLowerCase("de"), c.id]));

  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    let results: z.infer<typeof responseSchema>["results"] = [];
    try {
      const { output } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(categories, batch),
        output: Output.object({ schema: responseSchema }),
        maxRetries: 2,
        // 25 short answers fit easily; the cap only stops a runaway response from eating credits.
        maxOutputTokens: 3000,
      });
      results = output.results;
    } catch (error) {
      onError(error);
    }

    batch.forEach((item, i) => {
      const hit = results.find((r) => r.ref === `t${i + 1}`);
      const categoryId = hit ? byName.get(hit.category.trim().toLocaleLowerCase("de")) : undefined;
      if (!hit || !categoryId || !Number.isFinite(hit.confidence)) {
        verdicts.set(item.id, reviewOnly);
        return;
      }
      const confidence = Math.min(1, Math.max(0, hit.confidence));
      verdicts.set(item.id, { categoryId, confidence, needsReview: confidence < REVIEW_THRESHOLD });
    });
  }
  return verdicts;
}
