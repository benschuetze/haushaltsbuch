import { data, Link } from "react-router";
import { Amount } from "~/components/amount";
import { CategoryBars } from "~/components/category-bars";
import { Stat } from "~/components/stat";
import { getDb } from "~/lib/db/client";
import { countLabel, formatMonth } from "~/lib/format";
import { todayInGermany } from "~/lib/insights";
import { formatCents } from "~/lib/money";
import { MONTH_PATTERN, monthSummary, previousMonth } from "~/lib/queries";
import type { Route } from "./+types/monat";

export const meta: Route.MetaFunction = ({ params }) => [{ title: `${params.month} · Haushaltsbuch` }];

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export async function loader({ params }: Route.LoaderArgs) {
  if (!MONTH_PATTERN.test(params.month)) {
    throw data("Monat im Format JJJJ-MM angeben, z. B. 2026-09.", { status: 404 });
  }
  const db = getDb();
  const prev = previousMonth(params.month);
  // A running month is compared with the same days of the month before, not with all of it.
  const today = todayInGermany();
  const untilDay = today.startsWith(params.month) ? Number(today.slice(8, 10)) : undefined;
  const [summary, before] = await Promise.all([monthSummary(db, params.month), monthSummary(db, prev, untilDay)]);
  const next = nextMonth(params.month);
  // No link into a month that has not started: it could only be empty.
  return { month: params.month, prev, next, showNext: next <= today.slice(0, 7), summary, before, untilDay };
}

/** In words, not with a sign: "+251,70 €" on spending reads like more, when it meant less. */
function Change({
  now,
  before,
  kind,
  prevName,
  untilDay,
}: {
  now: number;
  before: number;
  kind: "income" | "expense";
  prevName: string;
  untilDay?: number;
}) {
  if (before === 0) return null;
  const diff = Math.abs(now) - Math.abs(before);
  const verb = kind === "income" ? "eingenommen" : "ausgegeben";
  const period = untilDay ? `im ${prevName} bis zum ${untilDay}.` : `im ${prevName}`;
  return (
    <p className="mt-1 text-xs font-normal text-muted-foreground">
      {diff === 0
        ? `Gleich viel ${verb} wie ${period}`
        : `${formatCents(Math.abs(diff))} ${diff > 0 ? "mehr" : "weniger"} ${verb} als ${period}`}
    </p>
  );
}

export default function Monat({ loaderData }: Route.ComponentProps) {
  const { month, prev, next, showNext, summary, before, untilDay } = loaderData;
  const prevName = formatMonth(prev).split(" ")[0] ?? prev;
  const expenses = summary.byCategory
    .filter((c) => c.kind !== "transfer" && c.cents < 0)
    .sort((a, b) => a.cents - b.cents);
  const income = summary.byCategory
    .filter((c) => c.kind !== "transfer" && c.cents > 0)
    .sort((a, b) => b.cents - a.cents);
  const transfers = summary.byCategory.filter((c) => c.kind === "transfer");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{formatMonth(month)}</h1>
        <nav aria-label="Monat wechseln" className="flex gap-2 text-sm">
          <Link to={`/monat/${prev}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">
            ← {formatMonth(prev)}
          </Link>
          {showNext ? (
            <Link to={`/monat/${next}`} className="rounded-md border px-3 py-1.5 hover:bg-accent">
              {formatMonth(next)} →
            </Link>
          ) : null}
        </nav>
      </div>

      {summary.transactionCount === 0 ? (
        <p role="status" className="rounded-lg border p-4">
          Für {formatMonth(month)} gibt es keine Buchungen.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Einnahmen" testId="income">
              <Amount cents={summary.incomeCents} />
              <Change
                now={summary.incomeCents}
                before={before.incomeCents}
                kind="income"
                prevName={prevName}
                untilDay={untilDay}
              />
            </Stat>
            <Stat label="Ausgaben" testId="expenses">
              <Amount cents={summary.expenseCents} />
              <Change
                now={summary.expenseCents}
                before={before.expenseCents}
                kind="expense"
                prevName={prevName}
                untilDay={untilDay}
              />
            </Stat>
            <Stat label="Saldo" testId="balance">
              <Amount cents={summary.incomeCents + summary.expenseCents} />
            </Stat>
          </dl>
          {summary.reviewCount > 0 ? (
            <p className="text-sm">
              In {formatMonth(month)} {summary.reviewCount === 1 ? "ist" : "sind"}{" "}
              {countLabel(summary.reviewCount, "Buchung", "Buchungen")} noch nicht geprüft.{" "}
              <Link to={`/transaktionen?monat=${month}&pruefen=1`} className="underline underline-offset-4">
                Jetzt prüfen
              </Link>
            </p>
          ) : null}
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Ausgaben nach Kategorie</h2>
            <CategoryBars items={expenses} label="Ausgaben nach Kategorie" />
          </section>
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Einnahmen</h2>
            <CategoryBars items={income} label="Einnahmen nach Kategorie" />
          </section>
          {transfers.length > 0 ? (
            <section className="space-y-1 text-sm text-muted-foreground">
              <h2 className="font-semibold">Umbuchungen (nicht in Ausgaben enthalten)</h2>
              <p data-testid="transfers">
                {countLabel(summary.transferCount, "Umbuchung", "Umbuchungen")} zwischen eigenen Konten ·{" "}
                {formatCents(summary.transferVolumeCents)} bewegt
              </p>
            </section>
          ) : null}
          <Link to={`/transaktionen?monat=${month}`} className="inline-block text-sm underline underline-offset-4">
            Alle Buchungen im {formatMonth(month)}
          </Link>
        </>
      )}
    </div>
  );
}
