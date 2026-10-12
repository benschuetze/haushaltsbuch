import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { knownMerchantCategory } from "../app/lib/categorize/known-merchants";
import type { EvalCase } from "./score";

const set = JSON.parse(readFileSync("evals/kategorisierung.json", "utf8")) as { cases: EvalCase[] };

describe("Eval-Set gegen die eingebaute Händlerliste (kostenlos, ohne Modell)", () => {
  it("jede Buchung, die die Händlerliste erkennt, landet in der richtigen Kategorie", () => {
    const wrong = set.cases
      .map((c) => ({ ...c, got: knownMerchantCategory(c.counterparty, c.amount_cents) }))
      .filter((c) => c.got !== null && c.got !== c.expected)
      .map((c) => `${c.id} ${c.counterparty}: ${c.got} statt ${c.expected}`);
    expect(wrong).toEqual([]);
  });

  it("das Set ist groß genug für eine Aussage", () => {
    expect(set.cases.length).toBeGreaterThanOrEqual(200);
    expect(new Set(set.cases.map((c) => c.id)).size).toBe(set.cases.length);
  });
});
