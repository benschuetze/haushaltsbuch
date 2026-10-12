import { Link } from "react-router";
import { Amount } from "~/components/amount";
import { AskToday } from "~/components/ask-today";
import { CategoryBars } from "~/components/category-bars";
import { BudgetBar } from "~/components/progress";
import { Stat } from "~/components/stat";
import { Button } from "~/components/ui/button";
import { weekCompareText } from "~/lib/budget/week-text";
import { getAssistantModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { formatMonth } from "~/lib/format";
import {
  budgetStatus,
  notificationSummary,
  openInsights,
  recurringPayments,
  spendingToday,
  weekToday,
} from "~/lib/insights";
import { formatCents } from "~/lib/money";
import { currentMonth, monthSummary, monthsWithData } from "~/lib/queries";
import type { Route } from "./+types/home";

export const meta: Route.MetaFunction = () => [{ title: "Übersicht · Haushaltsbuch" }];

export async function loader() {
  const db = getDb();
  const months = await monthsWithData(db);
  const now = currentMonth();
  // Bank exports lag behind; if this month has nothing yet, the latest month with data is the useful one.
  const month = months.includes(now) ? now : months[0];
  if (!month) return { month: null } as const;
  const [summary, budgets, insights, recurring, notifications, today, assistant, week] = await Promise.all([
    monthSummary(db, month),
    budgetStatus(db),
    openInsights(db, 20),
    recurringPayments(db),
    notificationSummary(db),
    spendingToday(db),
    getAssistantModel(),
    weekToday(db),
  ]);
  const subscriptions = recurring.filter((r) => r.active && r.kind === "subscription");
  return {
    month,
    today,
    week,
    assistant: assistant !== null,
    isCurrent: month === now,
    summary,
    // Same number the bell shows: everything waiting, not only this month.
    reviewCount: notifications.reviewCount,
    insightCount: insights.length,
    budgets: budgets.items
      .map((b) => ({ ...b, ratio: b.spentCents / b.budgetCents }))
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5),
    insights: insights.slice(0, 3),
    savingsCents: insights.reduce((s, i) => s + (i.savingsCentsPerYear ?? 0), 0),
    subscriptions: { count: subscriptions.length, yearlyCents: subscriptions.reduce((s, r) => s + r.yearlyCents, 0) },
  } as const;
}

function Card({
  title,
  link,
  children,
}: {
  title: string;
  link?: { to: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded border-2 border-foreground bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {link ? (
          <Link to={link.to} className="text-sm underline underline-offset-4">
            {link.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

const WEEKDAY = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** One line about the week, compared with the same weekdays before; the streak makes good weeks count. */
function WeekCard({ week }: { week: Route.ComponentProps["loaderData"]["week"] }) {
  if (!week) return null;
  const day = WEEKDAY[(new Date(`${week.today}T00:00:00Z`).getUTCDay() + 6) % 7];
  return (
    <section
      aria-labelledby="week-title"
      className="flex flex-wrap items-center justify-between gap-3 rounded border-2 border-foreground bg-card p-4"
    >
      <div className="space-y-0.5">
        <h2 id="week-title" className="pixel text-muted-foreground">
          Diese Woche ausgegeben
        </h2>
        <p className="text-2xl font-semibold tabular-nums" data-testid="week-spent">
          {formatCents(week.spentCents)}
        </p>
        <p className="text-sm" data-testid="week-compare">
          {weekCompareText(week, day ?? "heute")}
        </p>
      </div>
      {week.streakWeeks > 0 ? (
        <p className="pixel border-2 border-pen px-2 py-1 text-pen" data-testid="week-streak">
          Serie: {week.streakWeeks === 1 ? "1 Woche" : `${week.streakWeeks} Wochen`} unter Schnitt
        </p>
      ) : null}
    </section>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  if (!loaderData.month) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Übersicht</h1>
        <p>
          Noch keine Buchungen. Lade einen Kontoauszug hoch, dann rechnet die App Monat, Budgets und Sparpotenzial aus.
        </p>
        <Button asChild>
          <Link to="/import">Kontoauszug importieren</Link>
        </Button>
      </div>
    );
  }
  const {
    month,
    today,
    week,
    assistant,
    isCurrent,
    summary,
    reviewCount,
    insightCount,
    budgets,
    insights,
    savingsCents,
    subscriptions,
  } = loaderData;
  const topExpenses = summary.byCategory
    .filter((c) => c.kind !== "transfer" && c.kind !== "income" && c.cents < 0)
    .sort((a, b) => a.cents - b.cents)
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Übersicht</h1>
        <p className="text-muted-foreground">
          {formatMonth(month)}
          {isCurrent ? "" : " (letzter Monat mit Buchungen)"}
          {" · "}
          <Link to="/rueckblick" className="underline underline-offset-4">
            Monatsrückblick ansehen
          </Link>
        </p>
      </div>
      <AskToday today={today} assistant={assistant} />
      <WeekCard week={week} />
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
        <Stat label="Zu prüfen, gesamt" testId="review-count">
          {reviewCount > 0 ? (
            <Link to="/pruefen" className="underline underline-offset-4">
              {reviewCount}
            </Link>
          ) : (
            "0"
          )}
        </Stat>
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title={savingsCents > 0 ? "Sparpotenzial" : "Hinweise"}
          link={{ to: "/hinweise", label: "Alle Hinweise" }}
        >
          <p className="text-2xl font-semibold text-emerald-700" data-testid="savings">
            {savingsCents > 0
              ? `bis zu ${formatCents(savingsCents)} im Jahr`
              : insightCount > 0
                ? `${insightCount === 1 ? "1 Hinweis" : `${insightCount} Hinweise`} offen`
                : "Alles im grünen Bereich"}
          </p>
          {insights.length > 0 ? (
            <ul className="space-y-2">
              {insights.map((i) => (
                <li key={i.id}>
                  <Link to={`/hinweise#${i.id}`} className="block rounded-md border p-2 text-sm hover:bg-accent">
                    <span className="font-medium">{i.title}</span>
                    <span className="block text-muted-foreground">{i.body}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title="Budgets" link={{ to: "/budgets", label: "Bearbeiten" }}>
          {budgets.length === 0 ? (
            <p className="text-sm">Noch keine Budgets.</p>
          ) : (
            <ul className="space-y-3">
              {budgets.map((b) => (
                <li key={b.categoryId} className="space-y-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span>{b.categoryName}</span>
                    <span className="tabular-nums">
                      {formatCents(b.spentCents)} / {formatCents(b.budgetCents)}
                    </span>
                  </div>
                  <BudgetBar
                    spent={b.spentCents}
                    budget={b.budgetCents}
                    label={`${b.categoryName}: Anteil des Budgets`}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Abos" link={{ to: "/abos", label: "Alle ansehen" }}>
          <p className="text-sm">
            {subscriptions.count === 0
              ? "Noch keine erkannt. Dafür braucht es Auszüge aus mindestens zwei Monaten."
              : `${subscriptions.count} laufende Abos: ${formatCents(Math.round(subscriptions.yearlyCents / 12))} im Monat, ${formatCents(subscriptions.yearlyCents)} im Jahr.`}
          </p>
        </Card>

        <Card title="Größte Ausgaben" link={{ to: `/monat/${month}`, label: "Alle Kategorien" }}>
          {topExpenses.length > 0 ? (
            <CategoryBars items={topExpenses} label="Größte Ausgaben nach Kategorie" />
          ) : (
            <p className="text-sm">Keine Ausgaben.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
