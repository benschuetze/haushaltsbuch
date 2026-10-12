/**
 * Runs the eval set against the real model. Costs a few cents; never part of `pnpm test` or CI on push.
 * Usage: ANTHROPIC_API_KEY=... pnpm eval. Writes evals/ergebnis.md, which the README quotes.
 */
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { pickExamples } from "../app/lib/categorize/examples";
import { knownMerchantCategory } from "../app/lib/categorize/known-merchants";
import { categorizeWithLlm, type LlmVerdict } from "../app/lib/categorize/llm";
import { DEFAULT_MODEL, getModel } from "../app/lib/categorize/model";
import { DEFAULT_CATEGORIES } from "../app/lib/db/seed";
import { renderReport } from "./report";
import { type EvalCase, score } from "./score";

// Errors the user never sees: at most 2 % of the set.
const MAX_WRONG_CONFIDENT_SHARE = 0.02;

const set = JSON.parse(readFileSync("evals/kategorisierung.json", "utf8")) as {
  ambiguous: string[];
  cases: EvalCase[];
};
const model = getModel();
if (!model || process.env.AI_MOCK === "1") {
  console.error("pnpm eval braucht ANTHROPIC_API_KEY und läuft nicht mit AI_MOCK=1.");
  process.exit(1);
}

// Category ids only matter inside this run, so the names double as ids.
const categories = DEFAULT_CATEGORIES.map((c) => ({ id: c.name, name: c.name, kind: c.kind }));
// The same order as the app: the free merchant list first, the model only for what is left.
const free = new Map<string, LlmVerdict>();
for (const c of set.cases) {
  const name = knownMerchantCategory(c.counterparty, c.amount_cents);
  if (name) free.set(c.id, { categoryId: name, confidence: 1, needsReview: false });
}
const toModel = set.cases.filter((c) => !free.has(c.id));
const usage = { inputTokens: 0, outputTokens: 0 };
const FEW_SHOT = process.env.FEW_SHOT === "1";
const verdicts = await categorizeWithLlm(
  model,
  categories,
  toModel.map((c) => ({
    id: c.id,
    counterparty: c.counterparty,
    purpose: c.purpose,
    amountCents: c.amount_cents,
    bookingDate: "2026-09-15",
  })),
  undefined,
  (u) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  },
  // FEW_SHOT=1: the other cases stand in for the household's confirmed bookings. Never a batch's own cases,
  // otherwise the set would hand the model its answers.
  FEW_SHOT
    ? (batch) => {
        const own = new Set(batch.map((b) => b.id));
        const pool = set.cases
          .filter((c) => !own.has(c.id))
          .map((c) => ({
            counterparty: c.counterparty,
            purpose: c.purpose,
            amountCents: c.amount_cents,
            category: c.expected,
          }));
        return pickExamples(pool, batch);
      }
    : undefined,
);
for (const [id, v] of free) verdicts.set(id, v);
const report = score(set.cases, set.ambiguous, verdicts, (id) => id);
const modelReport = score(toModel, set.ambiguous, verdicts, (id) => id);

const markdown = renderReport(report, {
  date: new Date().toISOString().slice(0, 10),
  model: `${process.env.AI_MODEL || DEFAULT_MODEL}${FEW_SHOT ? ", mit Beispielen (Leave-one-out)" : ""}`,
  cases: set.cases.length,
  freeCases: free.size,
  modelCases: toModel.length,
  modelAccuracy: modelReport.accuracy,
  ...usage,
});
writeFileSync(FEW_SHOT ? "evals/ergebnis-beispiele.md" : "evals/ergebnis.md", markdown);
console.log(markdown);

const misses = report.rows.filter((r) => !r.correct);
if (misses.length > 0) {
  console.log("| Fall | Buchung | erwartet | bekommen | Konfidenz | prüfen |\n|---|---|---|---|---|---|");
  for (const r of misses) {
    console.log(
      `| ${r.id} | ${r.counterparty} / ${r.purpose} | ${r.expected} | ${r.got ?? "–"} | ${r.confidence.toFixed(2)} | ${r.needsReview ? "ja" : "nein"} |`,
    );
  }
}

const maxWrong = Math.floor(set.cases.length * MAX_WRONG_CONFIDENT_SHARE);
if (report.wrongConfident.length > maxWrong) {
  console.error(`\nZu viele sichere Fehler (${report.wrongConfident.length} > ${maxWrong}).`);
  process.exit(1);
}
