import { formatMonth } from "~/lib/format";
import { formatCents } from "~/lib/money";

/** A month told in a few cards to swipe through. Pure: the route gathers the numbers, this phrases them. */
export type StoryInput = {
  month: string;
  incomeCents: number;
  /** Negative, like bookings. */
  expenseCents: number;
  /** Negative category sums, transfers and income excluded. */
  categories: { name: string; cents: number }[];
  previousExpenseCents: number | null;
  biggest: { counterparty: string; amountCents: number; date: string } | null;
  subscriptions: { count: number; monthlyCents: number };
  /** Moved to own savings (transfers) plus deposits into savings goals. */
  savedCents: number;
};

export type StoryCard = { id: string; kicker: string; title: string; note: string; tone: "neutral" | "good" | "bad" };

export function monthStory(input: StoryInput): StoryCard[] {
  const spent = -input.expenseCents;
  const left = input.incomeCents + input.expenseCents;
  const cards: StoryCard[] = [
    {
      id: "summe",
      kicker: formatMonth(input.month),
      title: `${formatCents(spent)} ausgegeben`,
      note:
        input.incomeCents > 0
          ? `${formatCents(input.incomeCents)} kamen rein, ${left >= 0 ? `${formatCents(left)} blieben übrig` : `${formatCents(-left)} mehr raus als rein`}.`
          : "Einnahmen sind in diesem Monat keine gebucht.",
      tone: left >= 0 ? "good" : "bad",
    },
  ];
  const top = [...input.categories].sort((a, b) => a.cents - b.cents)[0];
  if (top && spent > 0) {
    cards.push({
      id: "kategorie",
      kicker: "Am meisten ging an",
      title: top.name,
      note: `${formatCents(-top.cents)}, das sind ${Math.round((-top.cents / spent) * 100)} % von allem.`,
      tone: "neutral",
    });
  }
  if (input.biggest) {
    const [y, m, d] = input.biggest.date.split("-");
    cards.push({
      id: "groesste",
      kicker: "Größte einzelne Ausgabe",
      title: formatCents(-input.biggest.amountCents),
      note: `${input.biggest.counterparty} am ${d}.${m}.${y}.`,
      tone: "neutral",
    });
  }
  if (input.previousExpenseCents !== null && input.previousExpenseCents < 0) {
    const diff = spent + input.previousExpenseCents; // positive: more than last month
    cards.push({
      id: "vergleich",
      kicker: "Im Vergleich zum Vormonat",
      title: diff <= 0 ? `${formatCents(-diff)} weniger` : `${formatCents(diff)} mehr`,
      note: diff <= 0 ? "Weiter so." : "Schau mal in die größten Posten oben.",
      tone: diff <= 0 ? "good" : "bad",
    });
  }
  if (input.subscriptions.count > 0) {
    cards.push({
      id: "abos",
      kicker: "Abos",
      title: `${input.subscriptions.count} laufen`,
      note: `Zusammen ${formatCents(input.subscriptions.monthlyCents)} im Monat. Alle noch in Gebrauch?`,
      tone: "neutral",
    });
  }
  cards.push(
    input.savedCents > 0
      ? {
          id: "gespart",
          kicker: "Zur Seite gelegt",
          title: formatCents(input.savedCents),
          note: "Geld, das für später da ist. Stark.",
          tone: "good",
        }
      : {
          id: "gespart",
          kicker: "Zur Seite gelegt",
          title: "Noch nichts",
          note: "Ein Sparziel macht's leichter: die Rate ist dann schon eingeplant.",
          tone: "neutral",
        },
  );
  return cards;
}
