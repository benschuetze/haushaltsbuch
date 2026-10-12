import type { LlmInput } from "./llm";

/** A booking the user filed or confirmed by hand, as the model may see it: the same four fields plus the answer. */
export type LlmExample = { counterparty: string; purpose: string; amountCents: number; category: string };

const STOP = new Set([
  "kartenzahlung",
  "girocard",
  "lastschrift",
  "sepa",
  "zahlung",
  "gmbh",
  "und",
  "der",
  "die",
  "das",
]);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLocaleLowerCase("de")
      .split(/[^a-zäöüß0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared === 0 ? 0 : shared / (a.size + b.size - shared);
}

/**
 * The few confirmed bookings most like this batch, so the model sees how this household files similar things
 * ("Kletterhalle" went to Hobbys here). Only examples that share a word count; at most `limit`, best first.
 */
export function pickExamples(pool: LlmExample[], batch: LlmInput[], limit = 5): LlmExample[] {
  const batchWords = batch.map((b) => words(`${b.counterparty} ${b.purpose}`));
  return pool
    .map((e) => {
      const w = words(`${e.counterparty} ${e.purpose}`);
      return { e, score: Math.max(0, ...batchWords.map((b) => overlap(w, b))) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}
