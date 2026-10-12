import { PartyPopper, PiggyBank, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { isReadOnly } from "~/lib/auth.server";
import { goalStatus } from "~/lib/budget/goals";
import { createGoal, deleteGoal, deposit, loadGoalInputs, savingsPlan } from "~/lib/budget/goals.server";
import { getDb } from "~/lib/db/client";
import { formatMonth } from "~/lib/format";
import { spendingToday, todayInGermany } from "~/lib/insights";
import { formatCents, parseGermanAmount } from "~/lib/money";
import type { Route } from "./+types/ziele";

export const meta: Route.MetaFunction = () => [{ title: "Sparziele · Haushaltsbuch" }];

export async function loader() {
  const db = getDb();
  const [available, all] = await Promise.all([spendingToday(db), loadGoalInputs(db, { includeAchieved: true })]);
  // Achieved goals stay visible as trophies; they no longer reserve anything.
  const statuses = all.map((g) => goalStatus(g, available.today, available.periodStart));
  const plan = await savingsPlan(db, available.today);
  const suggestion = plan && !statuses.some((g) => !g.done && g.fundedBy === plan.key) ? plan : null;
  return {
    readOnly: isReadOnly(),
    goals: statuses,
    perDayCents: available.perDayCents,
    suggestion,
    thisMonth: available.today.slice(0, 7),
  };
}

const euro = z
  .string()
  .trim()
  .min(1, "Betrag fehlt")
  .transform((v, ctx) => {
    try {
      const cents = parseGermanAmount(v.includes(",") ? v : `${v},00`);
      if (cents > 0 && cents <= 100_000_000) return cents;
    } catch {}
    ctx.addIssue({ code: "custom", message: "Bitte einen Betrag wie 800 oder 49,90 eingeben." });
    return z.NEVER;
  });

const actionSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create"),
    name: z.string().trim().min(1, "Wofür sparst du?").max(60),
    target: euro,
    due: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}$/)]),
    fromPlan: z.literal("1").optional(),
  }),
  z.object({ intent: z.literal("deposit"), goalId: z.uuid(), amount: euro }),
  z.object({ intent: z.literal("delete"), goalId: z.uuid() }),
]);

export async function action({ request }: Route.ActionArgs) {
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return data(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe.", celebrate: null },
      { status: 400 },
    );
  }
  const db = getDb();
  const input = parsed.data;
  if (input.intent === "create") {
    // The link is looked up again here, not taken from the form: only a standing order the app sees can feed a goal.
    const plan = input.fromPlan ? await savingsPlan(db, todayInGermany()) : null;
    // Without a deadline, a tenth of the target per month: a sensible default the user can change by depositing.
    await createGoal(db, {
      name: input.name,
      targetCents: input.target,
      dueMonth: plan ? null : input.due || null,
      monthlyCents: plan ? plan.monthlyCents : input.due ? null : Math.ceil(input.target / 10),
      fundedBy: plan?.key ?? null,
    });
    return {
      ok: true,
      message: `Sparziel „${input.name}“ angelegt. Die Monatsrate ist ab sofort im Tagesbudget eingeplant.`,
      celebrate: null,
    };
  }
  if (input.intent === "delete") {
    await deleteGoal(db, input.goalId);
    return { ok: true, message: "Sparziel gelöscht.", celebrate: null };
  }
  const reached = await deposit(db, input.goalId, input.amount, todayInGermany());
  return {
    ok: true,
    message: reached ? "Ziel erreicht!" : `${formatCents(input.amount)} zurückgelegt.`,
    celebrate: reached,
  };
}

function Confetti() {
  // A few CSS-animated pieces; no library, and nothing for people who prefer reduced motion.
  const colors = ["#16a34a", "#f59e0b", "#3b82f6", "#ec4899", "#8b5cf6"];
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-40 overflow-hidden motion-reduce:hidden">
      {Array.from({ length: 40 }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: static decoration, never reordered
          key={i}
          className="absolute top-[-1rem] block h-3 w-2 animate-[confetti_2.6s_ease-in_forwards] rounded-sm"
          style={{
            left: `${(i * 37) % 100}%`,
            backgroundColor: colors[i % colors.length],
            animationDelay: `${(i % 10) * 0.08}s`,
            transform: `rotate(${i * 29}deg)`,
          }}
        />
      ))}
    </div>
  );
}

/** This month and the following ones, as yyyy-mm. */
function byYear(months: string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const m of months) groups.set(m.slice(0, 4), [...(groups.get(m.slice(0, 4)) ?? []), m]);
  return [...groups.entries()];
}

function nextMonths(from: string, count: number): string[] {
  const [y, m] = from.split("-").map(Number) as [number, number];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

export default function Ziele({ loaderData, actionData }: Route.ComponentProps) {
  const { readOnly, goals, thisMonth, suggestion } = loaderData;
  // Filled by "Als Ziel übernehmen"; the form below stays the one place where a goal is created.
  const [prefill, setPrefill] = useState<{ name: string; target: string } | null>(null);
  // Once the goal is saved, the next one starts empty again.
  useEffect(() => {
    if (actionData?.ok) setPrefill(null);
  }, [actionData]);
  const busy = useNavigation().state !== "idle";
  const active = goals.filter((g) => !g.done);
  const done = goals.filter((g) => g.done);
  const perMonth = active.reduce((s, g) => s + g.perMonthCents, 0);

  return (
    <div className="space-y-6">
      {actionData?.celebrate ? <Confetti /> : null}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Sparziele</h1>
        <p className="text-sm text-muted-foreground">
          Wofür sparst du? Die Monatsrate ist im Tagesbudget schon abgezogen, du musst nichts mehr im Kopf behalten.
          {perMonth > 0 ? ` Zusammen ${formatCents(perMonth)} im Monat.` : ""}
        </p>
      </div>

      {actionData ? (
        <p
          role={actionData.ok ? "status" : "alert"}
          className={`flex items-center gap-2 rounded-lg border p-4 text-sm ${actionData.celebrate ? "border-emerald-300 bg-emerald-50 text-lg font-semibold text-emerald-900" : ""}`}
        >
          {actionData.celebrate ? <PartyPopper className="size-5" aria-hidden="true" /> : null}
          {actionData.message}
        </p>
      ) : null}

      {suggestion && !prefill ? (
        <section
          aria-labelledby="savings-plan"
          data-testid="savings-plan"
          className="space-y-2 rounded border-2 border-dashed border-foreground p-4 text-sm"
        >
          <h2 id="savings-plan" className="font-semibold">
            Du sparst schon
          </h2>
          <p>
            Seit {suggestion.months} Monaten gehen jeden Monat {formatCents(suggestion.monthlyCents)} an „
            {suggestion.counterparty}“. Gib dem Geld ein Ziel, dann siehst du, wann es reicht: Jede dieser Überweisungen
            zählt automatisch als eingezahlt, und das Tagesbudget plant die Rate weiter genau einmal ein.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              // A year of the rate as a starting point; the name and amount are the user's to change.
              setPrefill({ name: "Rücklage", target: String((suggestion.monthlyCents * 12) / 100).replace(".", ",") });
              requestAnimationFrame(() => document.getElementById("goal-name")?.focus());
            }}
          >
            Als Ziel übernehmen
          </Button>
        </section>
      ) : null}

      <section aria-labelledby="new-goal" className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
        <h2 id="new-goal" className="flex items-center gap-2 font-semibold">
          <PiggyBank className="size-5" aria-hidden="true" />
          Neues Sparziel
        </h2>
        {/* A new key after each saved goal empties the form, so a second tap does not create a duplicate. */}
        <Form
          key={actionData?.ok ? actionData.message : prefill ? "prefill" : "new"}
          method="post"
          className="grid gap-3 sm:grid-cols-[1fr_9rem_10rem_auto] sm:items-end"
        >
          <input type="hidden" name="intent" value="create" />
          <fieldset disabled={readOnly} className="contents">
            <div className="space-y-1 text-sm">
              <label htmlFor="goal-name" className="block">
                Wofür?
              </label>
              <Input
                id="goal-name"
                name="name"
                placeholder="z. B. Mallorca"
                maxLength={60}
                required
                defaultValue={prefill?.name}
              />
            </div>
            <div className="space-y-1 text-sm">
              <label htmlFor="goal-target" className="block">
                Betrag (€)
              </label>
              <Input
                id="goal-target"
                name="target"
                inputMode="decimal"
                placeholder="800"
                required
                defaultValue={prefill?.target}
              />
            </div>
            {prefill && suggestion ? (
              <p className="text-sm sm:self-center">
                <input type="hidden" name="fromPlan" value="1" />
                <input type="hidden" name="due" value="" />
                {formatCents(suggestion.monthlyCents)} im Monat per Dauerauftrag
              </p>
            ) : (
              <div className="space-y-1 text-sm">
                <label htmlFor="goal-due" className="block">
                  Bis wann? (optional)
                </label>
                {/* A select, not <input type="month">: Safari shows that one as "---------- ----". */}
                <select
                  id="goal-due"
                  name="due"
                  defaultValue=""
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">ohne festes Datum</option>
                  {/* Grouped by year: 60 months in one flat list were a long scroll on the phone. */}
                  {byYear(nextMonths(thisMonth, 60)).map(([year, months]) => (
                    <optgroup key={year} label={year}>
                      {months.map((m) => (
                        <option key={m} value={m}>
                          {formatMonth(m).split(" ")[0]}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
            <Button type="submit" disabled={busy}>
              Anlegen
            </Button>
          </fieldset>
        </Form>
        {readOnly ? (
          <p className="text-sm text-muted-foreground">In der Demo lassen sich keine Ziele anlegen.</p>
        ) : null}
      </section>

      {active.length === 0 && done.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Noch kein Ziel. Urlaub, neues Handy, Notgroschen: einfach oben eintragen.
        </p>
      ) : null}

      {active.length > 0 ? (
        <ul className="space-y-3" aria-label="Laufende Sparziele">
          {active.map((g) => {
            const pct = Math.min(100, Math.round((g.savedCents / g.targetCents) * 100));
            return (
              <li key={g.id} className="space-y-3 rounded-xl border p-4" data-testid="goal">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold">{g.name}</h2>
                  <span className="text-sm tabular-nums">
                    {formatCents(g.savedCents)} von {formatCents(g.targetCents)}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label={`${g.name}: gespart`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  className="h-3 rounded-full bg-muted"
                >
                  <div className="h-3 rounded-full bg-emerald-600 transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-sm text-muted-foreground" data-testid="goal-plan">
                  {formatCents(g.perMonthCents)} im Monat
                  {g.fundedBy ? " per Dauerauftrag" : ""}
                  {g.dueMonth ? `, bis ${formatMonth(g.dueMonth)}` : ""}
                  {g.stillToReserveCents > 0
                    ? ` · diesen Monat noch ${formatCents(g.stillToReserveCents)} offen`
                    : " · diesen Monat erledigt"}
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  <Form method="post" className="flex items-end gap-2">
                    <input type="hidden" name="intent" value="deposit" />
                    <input type="hidden" name="goalId" value={g.id} />
                    <div className="space-y-1 text-sm">
                      <label htmlFor={`deposit-${g.id}`} className="block">
                        Zurückgelegt (€)
                      </label>
                      <Input
                        id={`deposit-${g.id}`}
                        name="amount"
                        inputMode="decimal"
                        defaultValue={((g.stillToReserveCents || g.perMonthCents) / 100).toFixed(2).replace(".", ",")}
                        className="w-28"
                        disabled={readOnly}
                      />
                    </div>
                    <Button type="submit" variant="outline" disabled={busy || readOnly}>
                      Einzahlen
                    </Button>
                  </Form>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="goalId" value={g.id} />
                    <Button
                      type="submit"
                      variant="ghost"
                      size="icon"
                      aria-label={`${g.name} löschen`}
                      disabled={busy || readOnly}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </Form>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {done.length > 0 ? (
        <section className="space-y-2">
          <h2 className="font-semibold">Geschafft</h2>
          <ul className="flex flex-wrap gap-2" aria-label="Erreichte Sparziele">
            {done.map((g) => (
              <li key={g.id} className="rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-900">
                🏆 {g.name} · {formatCents(g.targetCents)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
