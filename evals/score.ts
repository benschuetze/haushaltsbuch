import type { LlmVerdict } from "../app/lib/categorize/llm";

export type EvalCase = { id: string; counterparty: string; purpose: string; amount_cents: number; expected: string };

export type EvalRow = EvalCase & { got: string | null; confidence: number; needsReview: boolean; correct: boolean };

export type EvalReport = {
  rows: EvalRow[];
  accuracy: number;
  reviewShare: number;
  /** Wrong and not flagged: the errors the user never sees. The number that must not go up. */
  wrongConfident: EvalRow[];
};

export function score(
  cases: EvalCase[],
  ambiguous: string[],
  verdicts: Map<string, LlmVerdict>,
  categoryName: (id: string) => string | undefined,
): EvalReport {
  const rows = cases.map((c) => {
    const v = verdicts.get(c.id);
    const got = v?.categoryId ? (categoryName(v.categoryId) ?? null) : null;
    const needsReview = v?.needsReview ?? true;
    // For genuinely ambiguous bookings, flagging them for review is the right answer too.
    const correct = got === c.expected || (ambiguous.includes(c.counterparty) && needsReview);
    return { ...c, got, confidence: v?.confidence ?? 0, needsReview, correct };
  });
  return {
    rows,
    accuracy: rows.filter((r) => r.correct).length / rows.length,
    reviewShare: rows.filter((r) => r.needsReview).length / rows.length,
    wrongConfident: rows.filter((r) => !r.correct && !r.needsReview),
  };
}
