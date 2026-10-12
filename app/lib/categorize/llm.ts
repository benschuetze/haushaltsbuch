import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import { safeError } from "~/lib/security.server";
import type { LlmExample } from "./examples";

/**
 * Measured, not guessed (pnpm eval, 203 bookings, 2026-10-12, see evals/ergebnis.md): without examples one silent
 * error is left at 0.7 (running shoes as "Kleidung" instead of "Hobbys", defensible either way) and 9.4 % go to
 * review; 0.8 would remove it for 12.3 %, 0.9 for 19.2 %. Answers at 0.7–0.9 were right 95 % of the time, at 0.9
 * and above 100 %. Re-check with pnpm eval whenever the prompt or the model changes.
 */
export const REVIEW_THRESHOLD = 0.7;
export const BATCH_SIZE = 25;
/**
 * Stored with every AI decision. Bump it whenever SYSTEM_PROMPT, CATEGORY_HINTS or the threshold change; a test
 * compares a fingerprint of all three and fails until the version moves along.
 */
export const PROMPT_VERSION = "2026-10-12.2";

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

/**
 * The allowed names go to the model as an enum, so it is steered to pick one of them. An answer outside the list
 * must not void the whole batch, though: .catch turns it into "" and only that booking goes to review.
 */
function responseSchemaFor(names: [string, ...string[]]) {
  return z.object({
    results: z.array(
      z.object({
        ref: z.string(),
        // "lebensmittel" is still Lebensmittel: spelling is normalised before the list is checked.
        category: z.preprocess(
          (v) =>
            typeof v === "string"
              ? (names.find((n) => n.toLocaleLowerCase("de") === v.trim().toLocaleLowerCase("de")) ?? v)
              : v,
          z.enum(names).catch(""),
        ),
        confidence: z.number(),
      }),
    ),
  });
}

/** Batches in flight at once: faster imports without a burst that trips the API's rate limit. */
export const PARALLEL_BATCHES = 3;

export const SYSTEM_PROMPT = `Du ordnest Kontobewegungen eines Privathaushalts in Deutschland Kategorien zu.
Regeln:
- Verwende ausschließlich einen Kategorienamen aus der übergebenen Liste, exakt so geschrieben (nur den Namen vor dem Doppelpunkt).
- Positive Beträge sind Eingänge, negative sind Ausgaben.
- "Umbuchung" nur für Geld zwischen eigenen Konten (Sparrate, Tagesgeld, Depot-Überträge).
- Bei PayPal oder Sammelzahlern entscheidet der Händler im Verwendungszweck.
- Wenn die Zuordnung unklar ist (z. B. Versandhändler mit gemischtem Sortiment, Bargeld, Überweisungen an Privatpersonen), nimm "Sonstiges" und eine Konfidenz unter 0.5.
- confidence ist eine Zahl zwischen 0 und 1: wie sicher du bist.
- Gib für jede Buchung genau ein Ergebnis mit ihrer ref zurück.
- Wenn Beispiele mitkommen, zeigen sie, wie dieser Haushalt ähnliche Buchungen selbst eingeordnet hat. Folge ihnen bei wirklich ähnlichen Buchungen.`;

/**
 * What each default category covers. With names alone the model has to guess where the borders are (a climbing
 * gym: hobby or leisure? child benefit: income or child costs?); the first eval run lost most points there.
 * Categories the user creates are sent with their name only.
 */
export const CATEGORY_HINTS: Record<string, string> = {
  Wohnen: "Miete, Nebenkosten, Strom, Gas, Wasser, Grundsteuer, Kabelanschluss nur wenn Teil der Miete",
  Lebensmittel: "Supermarkt, Discounter, Bäckerei, Metzgerei, Wochenmarkt, Lebensmittel-Lieferung",
  "Kind & Kita": "Kita- und Schulbeiträge, Babysitter, Kinderkurse, Spielzeug, Kinderkleidung, Klassenfahrt",
  Mobilität: "Tanken, Bus und Bahn, Taxi und Fahrdienste, E-Scooter, Werkstatt, Parken, Kfz-Steuer",
  Versicherungen: "Beiträge zu Versicherungen und Krankenkasse",
  "Abos & Verträge": "Streaming, Software, Cloud, Mobilfunk, Internet, Fitnessstudio-Mitgliedschaft",
  Hobbys:
    "Sport und Kurse (Kletterhalle, Tanzschule, Musikschule), Sportausrüstung, Instrumente, Bastelbedarf, Spiele, Bücher",
  Gesundheit: "Apotheke, Arzt, Zahnarzt, Physiotherapie, Optiker, Zuzahlungen",
  Freizeit: "Kino, Konzerte, Museen, Ausflüge, Freizeitparks, Bowling, Reisen und Hotels",
  Kleidung: "Kleidung und Schuhe für Erwachsene",
  Haushalt: "Drogerie, Baumarkt, Möbel, Haushalts- und Elektrogeräte, Waschsalon",
  "Restaurant & Lieferdienst": "Restaurants, Cafés, Imbiss, Kantine, Essens-Lieferdienste",
  Haustier: "Tierfutter, Tierarzt, Hundesteuer, Hundeschule",
  Gebühren: "Kontoentgelte, Zinsen, Rundfunkbeitrag, Behörden- und Ausweisgebühren",
  Einkommen:
    "nur Eingänge: Gehalt, Rente, Kindergeld, Elterngeld, Erstattungen, Verkäufe (Kleinanzeigen, Vinted), Honorare",
  Umbuchung: "Geld zwischen eigenen Konten: Tagesgeld, Depot, Ausgleich der Kreditkarte",
  Sonstiges: "alles, was in keine andere Kategorie passt oder unklar ist",
};

// Real purposes often carry IBANs ("Kto/IBAN: DE…"). They never help categorising and must not leave the app.
const IBAN_IN_TEXT = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g;

export function redactIbans(text: string): string {
  return text.replace(IBAN_IN_TEXT, "[IBAN]");
}

export function buildPrompt(categories: LlmCategory[], items: LlmInput[], examples: LlmExample[] = []): string {
  const lines = items.map((item, i) =>
    JSON.stringify({
      ref: `t${i + 1}`,
      counterparty: redactIbans(item.counterparty),
      purpose: redactIbans(item.purpose),
      amount: (item.amountCents / 100).toFixed(2),
      date: item.bookingDate,
    }),
  );
  const list = categories.map((c) =>
    CATEGORY_HINTS[c.name] ? `- ${c.name}: ${CATEGORY_HINTS[c.name]}` : `- ${c.name}`,
  );
  // Same four fields as the bookings themselves, IBANs blacked out: examples follow the same privacy rules.
  const shown = examples.map((e) =>
    JSON.stringify({
      counterparty: redactIbans(e.counterparty),
      purpose: redactIbans(e.purpose),
      amount: (e.amountCents / 100).toFixed(2),
      category: e.category,
    }),
  );
  const guide = shown.length
    ? `\n\nSo hat dieser Haushalt ähnliche Buchungen selbst eingeordnet (eine pro Zeile, JSON):\n${shown.join("\n")}`
    : "";
  return `Kategorien:\n${list.join("\n")}${guide}\n\nBuchungen (eine pro Zeile, JSON):\n${lines.join("\n")}`;
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
  /** Tokens per batch; the eval uses it to report what a booking costs. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void,
  /** Confirmed bookings like the ones in a batch, see pickExamples. */
  examplesFor?: (batch: LlmInput[]) => LlmExample[],
): Promise<Map<string, LlmVerdict>> {
  const verdicts = new Map<string, LlmVerdict>();
  const byName = new Map(categories.map((c) => [c.name.toLocaleLowerCase("de"), c.id]));

  const names = categories.map((c) => c.name) as [string, ...string[]];
  const responseSchema = responseSchemaFor(names);
  const batches: LlmInput[][] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) batches.push(items.slice(start, start + BATCH_SIZE));

  async function run(batch: LlmInput[]): Promise<void> {
    let results: z.infer<typeof responseSchema>["results"] = [];
    try {
      const { output, usage } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: buildPrompt(categories, batch, examplesFor?.(batch) ?? []),
        output: Output.object({ schema: responseSchema }),
        maxRetries: 2,
        // 25 short answers fit easily; the cap only stops a runaway response from eating credits.
        maxOutputTokens: 3000,
      });
      results = output.results;
      onUsage?.({ inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0 });
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

  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++] as LlmInput[];
      await run(batch);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_BATCHES, batches.length) }, worker));
  return verdicts;
}
