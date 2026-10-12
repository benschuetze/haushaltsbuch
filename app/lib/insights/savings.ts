import { formatCents } from "~/lib/money";

type WithSavings = { kind: string; savingsCentsPerYear: number | null };

/**
 * One wording for savings everywhere. A duplicate service is a floor (cancelling the dearer one saves more), so
 * "mindestens"; fees are projected from one month, so as soon as they are part of the sum it is "etwa".
 */
export function savingsText(items: WithSavings[]): string | null {
  const counted = items.filter((i) => (i.savingsCentsPerYear ?? 0) > 0);
  if (counted.length === 0) return null;
  const cents = counted.reduce((s, i) => s + (i.savingsCentsPerYear ?? 0), 0);
  const allFloors = counted.every((i) => i.kind === "duplicate_service");
  return `${allFloors ? "mindestens" : "etwa"} ${formatCents(cents)} im Jahr`;
}
