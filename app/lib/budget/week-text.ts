import { formatCents } from "~/lib/money";

/** The sentence under "Diese Woche ausgegeben"; "0,00 € weniger als sonst bis Montag" said nothing. */
export function weekCompareText(week: { spentCents: number; usualCents: number | null }, day: string): string {
  const { spentCents, usualCents } = week;
  if (usualCents === null) return "Für einen Vergleich fehlen noch ein paar Wochen.";
  if (spentCents === 0 && usualCents === 0) return "Bisher nichts ausgegeben.";
  if (spentCents === 0) return `Neue Woche, noch nichts ausgegeben. Sonst bis ${day}: ${formatCents(usualCents)}.`;
  const diff = usualCents - spentCents;
  if (diff === 0) return `Genau wie sonst bis ${day}.`;
  return diff > 0
    ? `${formatCents(diff)} weniger als sonst bis ${day}`
    : `${formatCents(-diff)} mehr als sonst bis ${day}`;
}
