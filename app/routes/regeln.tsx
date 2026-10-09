import { eq } from "drizzle-orm";
import { data, Form } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { isDemo } from "~/lib/auth.server";
import { reapplyRules } from "~/lib/categorize/apply";
import { ruleInputSchema } from "~/lib/categorize/rules";
import { getDb } from "~/lib/db/client";
import { rules } from "~/lib/db/schema";
import { countLabel } from "~/lib/format";
import { listCategories, listRules } from "~/lib/queries";
import type { Route } from "./+types/regeln";

export const meta: Route.MetaFunction = () => [{ title: "Regeln · Haushaltsbuch" }];

export async function loader() {
  const db = getDb();
  const [ruleRows, categories] = await Promise.all([listRules(db), listCategories(db)]);
  return { rules: ruleRows, categories, demo: isDemo() };
}

type ActionData = { ok: true; message: string } | { ok: false; message: string; ruleId?: string };

export async function action({ request }: Route.ActionArgs) {
  const form = Object.fromEntries(await request.formData());
  const db = getDb();
  const intent = form.intent;

  if (intent === "delete") {
    const id = z.uuid().safeParse(form.ruleId);
    if (!id.success) return data<ActionData>({ ok: false, message: "Regel nicht gefunden." }, { status: 400 });
    await db.delete(rules).where(eq(rules.id, id.data));
    // Deleting leaves existing categories in place: they were right when assigned, and moving them back to
    // "unknown" would throw away information.
    return data<ActionData>({ ok: true, message: "Regel gelöscht." });
  }

  const parsed = ruleInputSchema.safeParse(form);
  const ruleId = typeof form.ruleId === "string" ? form.ruleId : undefined;
  if (!parsed.success) {
    return data<ActionData>(
      { ok: false, message: parsed.error.issues[0]?.message ?? "Ungültige Eingabe.", ruleId },
      { status: 400 },
    );
  }

  if (intent === "update" && ruleId) {
    await db.update(rules).set(parsed.data).where(eq(rules.id, ruleId));
  } else if (intent === "create") {
    await db.insert(rules).values(parsed.data);
  } else {
    return data<ActionData>({ ok: false, message: "Unbekannte Aktion." }, { status: 400 });
  }
  const changed = await reapplyRules(db);
  return data<ActionData>({
    ok: true,
    message: `Regel gespeichert. ${countLabel(changed, "Buchung", "Buchungen")} umkategorisiert.`,
  });
}

const fieldClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

type RuleDefaults = {
  field: "counterparty" | "purpose";
  matchType: "contains" | "equals" | "regex";
  pattern: string;
  categoryId: string;
  priority: number;
};

function RuleFields({
  prefix,
  defaults,
  categories,
  disabled,
}: {
  prefix: string;
  defaults?: RuleDefaults;
  categories: { id: string; name: string }[];
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="grid gap-2 sm:grid-cols-[9rem_8rem_1fr_10rem_5rem]">
      <div className="space-y-1 text-sm">
        <label htmlFor={`${prefix}-field`} className="block">
          Feld
        </label>
        <select
          id={`${prefix}-field`}
          name="field"
          defaultValue={defaults?.field ?? "counterparty"}
          className={`${fieldClass} w-full`}
        >
          <option value="counterparty">Empfänger</option>
          <option value="purpose">Verwendungszweck</option>
        </select>
      </div>
      <div className="space-y-1 text-sm">
        <label htmlFor={`${prefix}-match`} className="block">
          Vergleich
        </label>
        <select
          id={`${prefix}-match`}
          name="matchType"
          defaultValue={defaults?.matchType ?? "contains"}
          className={`${fieldClass} w-full`}
        >
          <option value="contains">enthält</option>
          <option value="equals">ist gleich</option>
          <option value="regex">Regex</option>
        </select>
      </div>
      <div className="space-y-1 text-sm">
        <label htmlFor={`${prefix}-pattern`} className="block">
          Muster
        </label>
        <Input id={`${prefix}-pattern`} name="pattern" defaultValue={defaults?.pattern} required maxLength={200} />
      </div>
      <div className="space-y-1 text-sm">
        <label htmlFor={`${prefix}-category`} className="block">
          Kategorie
        </label>
        <select
          id={`${prefix}-category`}
          name="categoryId"
          defaultValue={defaults?.categoryId ?? ""}
          required
          className={`${fieldClass} w-full`}
        >
          <option value="" disabled>
            wählen
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1 text-sm">
        <label htmlFor={`${prefix}-priority`} className="block">
          Priorität
        </label>
        <Input
          id={`${prefix}-priority`}
          name="priority"
          type="number"
          defaultValue={defaults?.priority ?? 0}
          min={-1000}
          max={1000}
        />
      </div>
    </fieldset>
  );
}

export default function Regeln({ loaderData, actionData }: Route.ComponentProps) {
  const { rules: ruleRows, categories, demo } = loaderData;
  const result = actionData as ActionData | undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Regeln</h1>
        <p className="text-sm text-muted-foreground">
          Regeln laufen vor der KI. Höhere Priorität gewinnt, bei Gleichstand die ältere Regel. Manuell gesetzte
          Kategorien ändern sie nie.
        </p>
      </div>

      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={`rounded-lg border p-4 text-sm ${result.ok ? "" : "border-destructive text-destructive"}`}
        >
          {result.message}
        </p>
      ) : null}

      <section aria-labelledby="new-rule" className="space-y-3 rounded-lg border p-4">
        <h2 id="new-rule" className="font-semibold">
          Neue Regel
        </h2>
        <Form method="post" className="space-y-3">
          <input type="hidden" name="intent" value="create" />
          <RuleFields prefix="new" categories={categories} disabled={demo} />
          <Button type="submit" disabled={demo}>
            Regel anlegen
          </Button>
        </Form>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Bestehende Regeln ({ruleRows.length})</h2>
        {ruleRows.length === 0 ? (
          <p>Noch keine Regeln. Wenn du in „Buchungen“ eine Kategorie änderst, kannst du daraus eine Regel machen.</p>
        ) : (
          <ul className="space-y-3">
            {ruleRows.map((rule) => (
              <li key={rule.id} className="rounded-lg border p-3" data-testid="rule">
                <Form method="post" className="space-y-3" aria-label={`Regel ${rule.pattern}`}>
                  <input type="hidden" name="ruleId" value={rule.id} />
                  <RuleFields prefix={rule.id} defaults={rule} categories={categories} disabled={demo} />
                  <div className="flex gap-2">
                    <Button type="submit" name="intent" value="update" size="sm" variant="outline" disabled={demo}>
                      Speichern
                    </Button>
                    <Button
                      type="submit"
                      name="intent"
                      value="delete"
                      size="sm"
                      variant="ghost"
                      disabled={demo}
                      formNoValidate
                    >
                      Löschen
                    </Button>
                  </div>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
