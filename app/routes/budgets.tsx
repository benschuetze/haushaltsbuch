import { eq, notInArray } from "drizzle-orm";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";
import { BudgetBar } from "~/components/progress";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { isReadOnly } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { budgets, categories } from "~/lib/db/schema";
import { formatMonth } from "~/lib/format";
import { budgetStatus, refreshInsights } from "~/lib/insights";
import { formatCents, parseGermanAmount } from "~/lib/money";
import type { Route } from "./+types/budgets";

export const meta: Route.MetaFunction = () => [{ title: "Budgets · Haushaltsbuch" }];

export async function loader() {
  const db = getDb();
  const status = await budgetStatus(db);
  const withBudget = status.items.map((i) => i.categoryId);
  const free = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(withBudget.length > 0 ? notInArray(categories.id, withBudget) : undefined)
    .orderBy(categories.sortOrder);
  const expenseOnly = await db.select({ id: categories.id, kind: categories.kind }).from(categories);
  const kinds = new Map(expenseOnly.map((c) => [c.id, c.kind]));
  return { ...status, free: free.filter((c) => kinds.get(c.id) === "expense"), readOnly: isReadOnly() };
}

const euros = z
  .string()
  .trim()
  .transform((v, ctx) => {
    try {
      const cents = parseGermanAmount(v);
      if (cents <= 0) throw new Error();
      return cents;
    } catch {
      ctx.addIssue({ code: "custom", message: "Bitte einen Betrag größer 0 angeben, z. B. 450 oder 79,90." });
      return z.NEVER;
    }
  });

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("set"), categoryId: z.uuid(), amount: euros }),
  z.object({ intent: z.literal("delete"), categoryId: z.uuid() }),
  z.object({
    intent: z.literal("createCategory"),
    name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(40, "Der Name ist zu lang."),
    amount: z.union([z.literal(""), euros]),
  }),
]);

const PALETTE = ["#3a7bd5", "#2f9e8f", "#c2652a", "#8a55c4", "#c23a6b", "#6b8e23", "#b8860b", "#4a6fa5"];

export async function action({ request }: Route.ActionArgs) {
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success)
    return data(
      { ok: false as const, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  const db = getDb();
  const input = parsed.data;
  let message: string;
  if (input.intent === "set") {
    await db
      .insert(budgets)
      .values({ categoryId: input.categoryId, amountCents: input.amount })
      .onConflictDoUpdate({ target: budgets.categoryId, set: { amountCents: input.amount } });
    message = `Budget auf ${formatCents(input.amount)} gesetzt.`;
  } else if (input.intent === "delete") {
    await db.delete(budgets).where(eq(budgets.categoryId, input.categoryId));
    message = "Budget entfernt.";
  } else {
    const all = await db.select({ sortOrder: categories.sortOrder }).from(categories);
    const [created] = await db
      .insert(categories)
      .values({
        name: input.name,
        kind: "expense",
        color: PALETTE[all.length % PALETTE.length] ?? "#6f6f6f",
        sortOrder: Math.max(0, ...all.map((c) => c.sortOrder)) + 1,
      })
      .onConflictDoNothing({ target: categories.name })
      .returning();
    if (!created)
      return data({ ok: false as const, message: `Die Kategorie „${input.name}“ gibt es schon.` }, { status: 400 });
    if (input.amount) await db.insert(budgets).values({ categoryId: created.id, amountCents: input.amount });
    // New categories are offered to the model from the next import on.
    message = `Kategorie „${created.name}“ angelegt${input.amount ? ` mit ${formatCents(input.amount)} Budget` : ""}.`;
  }
  await refreshInsights(db);
  return data({ ok: true as const, message });
}

function euroInput(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",").replace(",00", "");
}

export default function Budgets({ loaderData, actionData }: Route.ComponentProps) {
  const { month, items, free, readOnly } = loaderData;
  const busy = useNavigation().state !== "idle";
  // The form sits right under the heading, opened by the button; open from the start when there is no budget yet.
  const [adding, setAdding] = useState(items.length === 0);
  const firstField = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    if (adding) firstField.current?.focus();
  }, [adding]);
  useEffect(() => {
    if (actionData?.ok) setAdding(false);
  }, [actionData]);
  const total = items.reduce((s, i) => s + i.budgetCents, 0);
  const spent = items.reduce((s, i) => s + i.spentCents, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Budgets</h1>
          <Button
            type="button"
            onClick={() => setAdding((open) => !open)}
            aria-expanded={adding}
            aria-controls="budget-add"
          >
            <Plus aria-hidden="true" />
            Budget hinzufügen
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {formatMonth(month)}: {formatCents(spent)} von {formatCents(total)} in Kategorien mit Budget. Wird ein Budget
          knapp oder überschritten, meldet sich die Glocke.
        </p>
      </div>
      {adding ? (
        <div id="budget-add" className="space-y-3">
          {free.length > 0 ? (
            <section aria-labelledby="add-budget" className="space-y-3 rounded-lg border p-4">
              <h2 id="add-budget" className="font-semibold">
                Budget hinzufügen
              </h2>
              <Form method="post" className="space-y-3">
                <input type="hidden" name="intent" value="set" />
                <fieldset disabled={readOnly || busy} className="space-y-3">
                  <div className="space-y-1">
                    <label htmlFor="add-category" className="block text-sm">
                      Kategorie
                    </label>
                    <select
                      ref={firstField}
                      id="add-category"
                      name="categoryId"
                      required
                      defaultValue=""
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="" disabled>
                        wählen
                      </option>
                      {free.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="add-amount" className="block text-sm">
                      Betrag pro Monat (€)
                    </label>
                    <Input id="add-amount" name="amount" inputMode="decimal" required placeholder="z. B. 100" />
                  </div>
                  <Button type="submit">Hinzufügen</Button>
                </fieldset>
              </Form>
            </section>
          ) : null}
          {/* A different thing from a budget: tucked away until it is needed. */}
          <details className="space-y-3 rounded-lg border p-4">
            <summary className="cursor-pointer font-semibold">Kategorie fehlt? Neue anlegen</summary>
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="createCategory" />
              <fieldset disabled={readOnly || busy} className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="category-name" className="block text-sm">
                    Name
                  </label>
                  <Input id="category-name" name="name" required maxLength={40} placeholder="z. B. Urlaub" />
                </div>
                <div className="space-y-1">
                  <label htmlFor="category-amount" className="block text-sm">
                    Budget pro Monat (€, optional)
                  </label>
                  <Input id="category-amount" name="amount" inputMode="decimal" placeholder="leer = kein Budget" />
                </div>
                <Button type="submit" variant="outline">
                  Kategorie anlegen
                </Button>
              </fieldset>
            </Form>
          </details>
        </div>
      ) : null}
      {actionData ? (
        <p
          role={actionData.ok ? "status" : "alert"}
          className={`rounded-lg border p-4 text-sm ${actionData.ok ? "bg-muted/50" : "border-destructive text-destructive"}`}
        >
          {actionData.message}
        </p>
      ) : null}

      <ul className="space-y-3" aria-label="Budgets">
        {items.map((b) => (
          <li key={b.categoryId} className="space-y-2 rounded-lg border p-3" data-testid="budget">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">{b.categoryName}</h2>
              <p className="text-sm tabular-nums" data-testid="budget-usage">
                {formatCents(b.spentCents)} von {formatCents(b.budgetCents)}
              </p>
            </div>
            <BudgetBar spent={b.spentCents} budget={b.budgetCents} label={`${b.categoryName}: Anteil des Budgets`} />
            {/* Also once the budget is gone: "68 € of 50 €" next to "117 € a month" on Abos would look like a contradiction. */}
            {b.projectedCents !== null && b.projectedCents > b.spentCents ? (
              <p
                className={
                  b.projectedCents > b.budgetCents ? "text-xs text-amber-700" : "text-xs text-muted-foreground"
                }
                data-testid="budget-projection"
              >
                Bis Monatsende etwa {formatCents(b.projectedCents)}.
              </p>
            ) : null}
            <Form method="post" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="categoryId" value={b.categoryId} />
              <div className="space-y-1">
                <label htmlFor={`amount-${b.categoryId}`} className="block text-xs text-muted-foreground">
                  Budget pro Monat (€)
                </label>
                <Input
                  id={`amount-${b.categoryId}`}
                  name="amount"
                  inputMode="decimal"
                  defaultValue={euroInput(b.budgetCents)}
                  key={b.budgetCents}
                  className="w-28"
                  disabled={readOnly}
                />
              </div>
              <Button type="submit" name="intent" value="set" size="sm" variant="outline" disabled={readOnly || busy}>
                Speichern
              </Button>
              <Button type="submit" name="intent" value="delete" size="sm" variant="ghost" disabled={readOnly || busy}>
                Entfernen
              </Button>
            </Form>
          </li>
        ))}
      </ul>
    </div>
  );
}
