import type { LlmVerdict } from "../app/lib/categorize/llm";

export type EvalCase = { id: string; counterparty: string; purpose: string; amount_cents: number; expected: string };

export type EvalRow = EvalCase & { got: string | null; confidence: number; needsReview: boolean; correct: boolean };

export type CategoryScore = { category: string; cases: number; correct: number; accuracy: number };
export type Confusion = { expected: string; got: string; count: number };
export type Bucket = { label: string; from: number; to: number; cases: number; accuracy: number | null };
export type ThresholdOption = { threshold: number; reviewShare: number; wrongConfident: number };

export type EvalReport = {
  rows: EvalRow[];
  accuracy: number;
  reviewShare: number;
  /** Wrong and not flagged: the errors the user never sees. The number that must not go up. */
  wrongConfident: EvalRow[];
  byCategory: CategoryScore[];
  /** Which category the model picked instead, most frequent first. */
  confusions: Confusion[];
  /** Is a stated confidence of 0.8 right about 80 % of the time? */
  calibration: Bucket[];
  /** What other review thresholds would have cost (more review) or let through (more silent errors). */
  thresholds: ThresholdOption[];
};

const BUCKETS: [string, number, number][] = [
  ["0–0,5", 0, 0.5],
  ["0,5–0,7", 0.5, 0.7],
  ["0,7–0,9", 0.7, 0.9],
  ["0,9–1,0", 0.9, 1.0001],
];
const THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9];

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

  const categories = [...new Set(rows.map((r) => r.expected))].sort();
  const byCategory = categories.map((category) => {
    const of = rows.filter((r) => r.expected === category);
    const correct = of.filter((r) => r.correct).length;
    return { category, cases: of.length, correct, accuracy: correct / of.length };
  });

  const pairs = new Map<string, Confusion>();
  for (const r of rows) {
    if (r.got === null || r.got === r.expected) continue;
    const key = `${r.expected}→${r.got}`;
    const entry = pairs.get(key) ?? { expected: r.expected, got: r.got, count: 0 };
    entry.count++;
    pairs.set(key, entry);
  }
  const confusions = [...pairs.values()].sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected));

  // Calibration looks at whether the named category was right, regardless of review: that is what confidence claims.
  const named = rows.filter((r) => r.got !== null);
  const calibration = BUCKETS.map(([label, from, to]) => {
    const inside = named.filter((r) => r.confidence >= from && r.confidence < to);
    const right = inside.filter((r) => r.got === r.expected).length;
    return {
      label,
      from,
      to: Math.min(to, 1),
      cases: inside.length,
      accuracy: inside.length ? right / inside.length : null,
    };
  });

  const thresholds = THRESHOLDS.map((threshold) => {
    const flagged = (r: EvalRow) => r.got === null || r.confidence < threshold;
    // An ambiguous case answered confidently with a guess is a silent error too, so no exception for them here.
    const wrong = rows.filter((r) => !flagged(r) && r.got !== r.expected).length;
    return {
      threshold,
      reviewShare: rows.filter(flagged).length / rows.length,
      wrongConfident: wrong,
    };
  });

  return {
    rows,
    accuracy: rows.filter((r) => r.correct).length / rows.length,
    reviewShare: rows.filter((r) => r.needsReview).length / rows.length,
    wrongConfident: rows.filter((r) => !r.correct && !r.needsReview),
    byCategory,
    confusions,
    calibration,
    thresholds,
  };
}
