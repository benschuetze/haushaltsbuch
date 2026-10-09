import { Link } from "react-router";
import { Amount } from "~/components/amount";
import { CategoryBars } from "~/components/category-bars";
import { Stat } from "~/components/stat";
import { Button } from "~/components/ui/button";
import { getDb } from "~/lib/db/client";
import { formatMonth } from "~/lib/format";
import { currentMonth, monthSummary, monthsWithData } from "~/lib/queries";
import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () => [{ title: "Übersicht · Haushaltsbuch" }];

export async function loader() {
  const db = getDb();
  const months = await monthsWithData(db);
  const now = currentMonth();
  // Bank exports lag behind; if this month has nothing yet, the latest month with data is the useful one.
  const month = months.includes(now) ? now : months[0];
  if (!month) return { month: null, summary: null, isCurrent: false };
  return { month, summary: await monthSummary(db, month), isCurrent: month === now };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { month, summary, isCurrent } = loaderData;
  if (!month || !summary) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Übersicht</h1>
        <p>Noch keine Buchungen. Lade einen Kontoauszug als CSV hoch, dann erscheint hier der Monat.</p>
        <Button asChild>
          <Link to="/import">Kontoauszug importieren</Link>
        </Button>
      </div>
    );
  }

  const topExpenses = summary.byCategory
    .filter((c) => c.kind !== "transfer" && c.kind !== "income" && c.cents < 0)
    .sort((a, b) => a.cents - b.cents)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Übersicht</h1>
        <p className="text-muted-foreground">
          {formatMonth(month)}
          {isCurrent ? "" : " (letzter Monat mit Buchungen)"}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Einnahmen" testId="income">
          <Amount cents={summary.incomeCents} />
        </Stat>
        <Stat label="Ausgaben" testId="expenses">
          <Amount cents={summary.expenseCents} />
        </Stat>
        <Stat label="Saldo">
          <Amount cents={summary.incomeCents + summary.expenseCents} />
        </Stat>
        <Stat label="Zu prüfen" testId="review-count">
          {summary.reviewCount > 0 ? (
            <Link to="/transaktionen?pruefen=1" className="underline underline-offset-4">
              {summary.reviewCount}
            </Link>
          ) : (
            "0"
          )}
        </Stat>
      </dl>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Größte Ausgaben</h2>
        {topExpenses.length > 0 ? (
          <CategoryBars items={topExpenses} label="Größte Ausgaben nach Kategorie" />
        ) : (
          <p>Keine Ausgaben.</p>
        )}
      </section>
      <Button asChild variant="outline">
        <Link to={`/monat/${month}`}>Ganzen Monat ansehen</Link>
      </Button>
    </div>
  );
}
