import { data, Form, useNavigation } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { isDemo } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { formatMonth } from "~/lib/format";
import { dismissInsight, markInsightsRead, openInsights } from "~/lib/insights";
import { savingsText } from "~/lib/insights/savings";
import type { Route } from "./+types/hinweise";

export const meta: Route.MetaFunction = () => [{ title: "Hinweise · Haushaltsbuch" }];

export async function loader() {
  const db = getDb();
  const items = await openInsights(db, 50);
  // Opening the list counts as reading it; the dot on the bell goes away for these.
  if (!isDemo()) await markInsightsRead(db);
  return { items, demo: isDemo() };
}

export async function action({ request }: Route.ActionArgs) {
  const id = z.uuid().safeParse((await request.formData()).get("id"));
  if (!id.success) return data({ ok: false }, { status: 400 });
  await dismissInsight(getDb(), id.data);
  return data({ ok: true });
}

export default function Hinweise({ loaderData }: Route.ComponentProps) {
  const { items, demo } = loaderData;
  const busy = useNavigation().state !== "idle";
  const savings = savingsText(items);
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Hinweise</h1>
        <p className="text-sm text-muted-foreground">
          Die App rechnet nach jedem Import nach: Budgets, Abos, Preiserhöhungen, doppelte Dienste, Ausreißer, Gebühren.
          {savings ? ` Zusammen ${savings} Sparpotenzial.` : ""}
        </p>
      </div>
      {items.length === 0 ? <p className="rounded-lg border p-4">Gerade gibt es nichts zu melden.</p> : null}
      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i.id} id={i.id} className="scroll-mt-28 space-y-2 rounded-lg border p-4" data-testid="insight">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{i.title}</h2>
              <span className="text-xs text-muted-foreground">{formatMonth(i.month)}</span>
            </div>
            <p className="text-sm">{i.body}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {i.savingsCentsPerYear ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                  {savingsText([i])}
                </span>
              ) : (
                <span />
              )}
              <Form method="post">
                <input type="hidden" name="id" value={i.id} />
                <Button type="submit" size="sm" variant="ghost" disabled={demo || busy}>
                  Erledigt
                </Button>
              </Form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
