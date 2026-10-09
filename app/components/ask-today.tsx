import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { formatCents } from "~/lib/money";
import { cn } from "~/lib/utils";

export type TodayView = {
  perDayCents: number;
  freeCents: number;
  daysLeft: number;
  nextIncome: { name: string; date: string; amountCents: number } | null;
  missingIncome: { name: string; date: string; amountCents: number } | null;
  incomeCents: number;
  spentCents: number;
  upcoming: { name: string; date: string; amountCents: number }[];
};

const SUGGESTIONS = [
  "Wie viel kann ich heute ausgeben?",
  "Kann ich mir 80 € fürs Feiern leisten?",
  "Wann kommt mein Gehalt?",
  "Was geht diese Woche noch ab?",
];

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    Date.UTC(y, m - 1, d),
  );
}

type Turn = { id: number; question: string; answer: string | null };

/**
 * The first thing on the start page: today's number, no question needed, and right below a box to ask
 * anything ("Kann ich mir … leisten?"). The answer appears in place; a follow-up keeps the last turns.
 */
export function AskToday({ today, assistant }: { today: TodayView; assistant: boolean }) {
  const fetcher = useFetcher<{ answer: string; tools: string[] }>();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const handled = useRef<unknown>(null);
  const nextId = useRef(0);
  const busy = fetcher.state !== "idle";
  const overdrawn = today.freeCents < 0;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && handled.current !== fetcher.data) {
      handled.current = fetcher.data;
      const answer = fetcher.data.answer;
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)));
    }
  }, [fetcher.state, fetcher.data]);

  function ask(text: string) {
    const question = text.trim().slice(0, 500);
    if (!question || busy) return;
    const history = turns
      .slice(-2)
      .flatMap((t) => [
        { role: "user" as const, content: t.question },
        ...(t.answer ? [{ role: "assistant" as const, content: t.answer }] : []),
      ]);
    nextId.current += 1;
    setTurns((t) => [...t.slice(-2), { id: nextId.current, question, answer: null }]);
    setDraft("");
    fetcher.submit(
      { messages: JSON.stringify([...history, { role: "user", content: question }]) },
      { method: "post", action: "/assistent" },
    );
  }

  return (
    <section
      aria-labelledby="today-title"
      className="space-y-5 rounded-2xl border bg-gradient-to-br from-emerald-50 to-background p-5 shadow-sm dark:from-emerald-950/30"
    >
      <div className="space-y-1">
        <h2 id="today-title" className="text-sm font-medium text-muted-foreground">
          Heute drin
        </h2>
        <p
          className={cn(
            "text-5xl font-bold tracking-tight tabular-nums",
            overdrawn ? "text-red-700" : "text-emerald-800",
          )}
          data-testid="today-amount"
        >
          {formatCents(today.perDayCents)}
        </p>
        <p className="text-sm" data-testid="today-context">
          {overdrawn
            ? `Bis ${today.nextIncome ? `zum Gehalt am ${longDate(today.nextIncome.date)}` : "Monatsende"} fehlen ${formatCents(-today.freeCents)}.`
            : `${formatCents(today.freeCents)} frei bis ${today.nextIncome ? `zum Gehalt am ${longDate(today.nextIncome.date)}` : "Monatsende"} · noch ${today.daysLeft === 1 ? "1 Tag" : `${today.daysLeft} Tage`}`}
        </p>
        {today.missingIncome ? (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-950" data-testid="missing-income">
            Das Gehalt vom {longDate(today.missingIncome.date)} ist noch nicht in den Buchungen. Die Zahl rechnet ohne;
            nach dem nächsten Import oder Bankabruf stimmt sie wieder.
          </p>
        ) : null}
        <details className="text-sm text-muted-foreground">
          <summary className="cursor-pointer">Wie gerechnet?</summary>
          <ul className="mt-2 space-y-1">
            <li>
              Seit dem letzten Gehalt eingenommen:{" "}
              <span className="tabular-nums">{formatCents(today.incomeCents)}</span>
            </li>
            <li>
              Ausgegeben: <span className="tabular-nums">−{formatCents(today.spentCents)}</span>
            </li>
            {today.upcoming.map((u) => (
              <li key={`${u.name}-${u.date}`}>
                Noch fällig am {longDate(u.date)}: {u.name}{" "}
                <span className="tabular-nums">−{formatCents(u.amountCents)}</span>
              </li>
            ))}
            <li>
              Ergibt {formatCents(today.freeCents)}, verteilt auf {today.daysLeft} Tage.
            </li>
          </ul>
        </details>
      </div>

      {assistant ? (
        <div className="space-y-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <Sparkles
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Frag einfach: Kann ich mir … leisten?"
              aria-label="Frage an dein Haushaltsbuch"
              maxLength={500}
              className="h-12 w-full rounded-xl border border-input bg-background pr-12 pl-9 text-base shadow-xs focus-visible:outline-2 focus-visible:outline-ring"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Fragen"
              className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUp className="size-4" aria-hidden="true" />
              )}
            </button>
          </form>
          {turns.length === 0 ? (
            <fieldset className="flex min-w-0 flex-wrap gap-2" aria-label="Vorschläge">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded-full border bg-background px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {s}
                </button>
              ))}
            </fieldset>
          ) : (
            <ol className="space-y-3" aria-live="polite" data-testid="ask-turns">
              {turns.map((t) => (
                <li key={t.id} className="space-y-1.5">
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {t.question}
                  </p>
                  <p
                    className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm border bg-background px-3 py-2 text-sm"
                    data-testid="ask-answer"
                  >
                    {t.answer ?? <Loader2 className="size-4 animate-spin" aria-label="Antwort kommt" />}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
