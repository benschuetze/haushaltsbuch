import { and, asc, eq, gte, isNull, lt, ne, or } from "drizzle-orm";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { data, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { monthStory } from "~/lib/budget/story";
import { clockNow } from "~/lib/clock";
import { getDb } from "~/lib/db/client";
import { categories, savingsDeposits, transactions } from "~/lib/db/schema";
import { formatMonth } from "~/lib/format";
import { monthFlows, recurringPayments, todayInGermany } from "~/lib/insights";
import { MONTH_PATTERN, monthRange, monthSummary, monthsWithData } from "~/lib/queries";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/rueckblick";

export const meta: Route.MetaFunction = ({ data: d }) => [
  { title: d?.month ? `${formatMonth(d.month)} · Rückblick · Haushaltsbuch` : "Rückblick · Haushaltsbuch" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const months = await monthsWithData(db); // newest first
  const asked = new URL(request.url).searchParams.get("monat");
  const current = clockNow().toISOString().slice(0, 7);
  // By default the last finished month: a story about half a month is half a story.
  const month = asked && MONTH_PATTERN.test(asked) ? asked : (months.find((m) => m < current) ?? months[0]);
  if (!month || !months.includes(month)) {
    throw data("Für diesen Monat gibt es keine Buchungen.", { status: 404 });
  }
  const index = months.indexOf(month);
  const previous = months[index + 1] ?? null;
  const { from, to } = monthRange(month);

  const [summary, previousSummary, biggestRows, recurring, flows, deposits] = await Promise.all([
    monthSummary(db, month),
    // The running month (only when asked for) is compared with the same days of the month before.
    previous ? monthSummary(db, previous, month === current ? Number(todayInGermany().slice(8, 10)) : undefined) : null,
    db
      .select({
        counterparty: transactions.counterparty,
        amountCents: transactions.amountCents,
        date: transactions.bookingDate,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(
        and(
          gte(transactions.bookingDate, from),
          lt(transactions.bookingDate, to),
          lt(transactions.amountCents, 0),
          or(isNull(categories.kind), ne(categories.kind, "transfer")),
        ),
      )
      .orderBy(asc(transactions.amountCents))
      .limit(1),
    recurringPayments(db),
    monthFlows(db),
    db
      .select({ amountCents: savingsDeposits.amountCents })
      .from(savingsDeposits)
      .where(and(gte(savingsDeposits.depositedOn, from), lt(savingsDeposits.depositedOn, to))),
  ]);
  const subscriptions = recurring.filter((r) => r.active && r.kind === "subscription");
  const cards = monthStory({
    month,
    incomeCents: summary.incomeCents,
    expenseCents: summary.expenseCents,
    categories: summary.byCategory
      .filter((c) => c.kind !== "transfer" && c.kind !== "income" && c.cents < 0)
      .map((c) => ({ name: c.name, cents: c.cents })),
    previousExpenseCents: previousSummary?.expenseCents ?? null,
    biggest: biggestRows[0] ?? null,
    subscriptions: {
      count: subscriptions.length,
      monthlyCents: Math.round(subscriptions.reduce((s, r) => s + r.yearlyCents, 0) / 12),
    },
    savedCents:
      (flows.find((f) => f.month === month)?.savedCents ?? 0) + deposits.reduce((s, d) => s + d.amountCents, 0),
  });
  return { month, cards, newer: months[index - 1] ?? null, older: previous };
}

/** E-ink cards: ink on paper, inverted for good news, red ink only when it went wrong. */
const TONE = {
  good: "bg-foreground text-background",
  bad: "bg-red-700 text-background",
  neutral: "bg-card text-foreground border-2 border-foreground",
} as const;

/** Full-width cards in a horizontal scroll with snap points: swiping is the browser's own, no library. */
export default function Rueckblick({ loaderData }: Route.ComponentProps) {
  const { month, cards, newer, older } = loaderData;
  const [active, setActive] = useState(0);
  const strip = useRef<HTMLDivElement>(null);
  const go = (i: number) =>
    strip.current?.children[i]?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });

  return (
    <div className="mx-auto max-w-md space-y-4">
      <div className="flex items-center justify-between gap-2">
        {older ? (
          <Link
            to={`/rueckblick?monat=${older}`}
            className="rounded-md p-1 hover:bg-accent"
            aria-label={`Rückblick ${formatMonth(older)}`}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <span className="size-7" />
        )}
        <h1 className="text-lg font-semibold">Dein {formatMonth(month)}</h1>
        {newer ? (
          <Link
            to={`/rueckblick?monat=${newer}`}
            className="rounded-md p-1 hover:bg-accent"
            aria-label={`Rückblick ${formatMonth(newer)}`}
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <span className="size-7" />
        )}
      </div>

      <div className="flex gap-1.5" aria-hidden="true">
        {cards.map((c, i) => (
          <span key={c.id} className={cn("h-1 flex-1 rounded-full", i <= active ? "bg-foreground" : "bg-muted")} />
        ))}
      </div>

      {/* Above the cards: at the bottom the floating chat button would sit on top of "Weiter" on phones. */}
      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={() => go(Math.max(0, active - 1))} disabled={active === 0}>
          Zurück
        </Button>
        <Button onClick={() => go(Math.min(cards.length - 1, active + 1))} disabled={active === cards.length - 1}>
          Weiter
        </Button>
      </div>
      {/* The scrollable strip itself takes focus, so arrow keys page through it like swiping does. */}
      <section
        ref={strip}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard (WCAG 2.1.1)
        tabIndex={0}
        aria-label="Rückblick, Karten zum Weiterblättern"
        onScroll={(e) => {
          const el = e.currentTarget;
          setActive(Math.round(el.scrollLeft / el.clientWidth));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(Math.min(cards.length - 1, active + 1));
          if (e.key === "ArrowLeft") go(Math.max(0, active - 1));
        }}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-3xl [scrollbar-width:none] focus-visible:outline-2 focus-visible:outline-ring"
        data-testid="story"
      >
        {cards.map((c) => (
          <article
            key={c.id}
            aria-label={c.kicker}
            className={cn(
              "flex min-h-[60vh] w-full shrink-0 snap-start flex-col justify-center gap-3 rounded p-8",
              TONE[c.tone],
            )}
            data-testid="story-card"
          >
            <p className="pixel opacity-80">{c.kicker}</p>
            <p className="font-serif text-5xl leading-none font-bold break-words">{c.title}</p>
            {c.note ? <p className="text-base opacity-90">{c.note}</p> : null}
          </article>
        ))}
      </section>
      <p className="text-center text-xs text-muted-foreground">Wischen, Pfeiltasten oder „Weiter“</p>
    </div>
  );
}
