import { eq } from "drizzle-orm";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { data, Form, useFetcher } from "react-router";
import { z } from "zod";
import { Amount } from "~/components/amount";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { isDemo } from "~/lib/auth.server";
import { reapplyRules } from "~/lib/categorize/apply";
import { getModel } from "~/lib/categorize/model";
import {
  parseRuleWish,
  previewRule,
  proposeRule,
  type RulePreview,
  type RuleProposal,
} from "~/lib/categorize/rule-agent";
import { ruleInputSchema } from "~/lib/categorize/rules";
import type { Db } from "~/lib/db/client";
import { getDb } from "~/lib/db/client";
import { meta as metaTable, rules, transactions } from "~/lib/db/schema";
import { countLabel, formatDate } from "~/lib/format";
import { refreshInsights } from "~/lib/insights";
import { listCategories, listRules } from "~/lib/queries";
import type { Route } from "./+types/regeln";

export const meta: Route.MetaFunction = () => [{ title: "Regeln · Haushaltsbuch" }];

export async function loader() {
  const db = getDb();
  const [ruleRows, categories] = await Promise.all([listRules(db), listCategories(db)]);
  return { rules: ruleRows, categories, demo: isDemo() };
}

type ActionData =
  | { ok: true; message: string }
  | { ok: false; message: string; ruleId?: string }
  | { proposals: { proposal: RuleProposal; preview: RulePreview }[]; message?: string };

/** Model calls for rule wishes per day; local parsing does not count. */
const AGENT_DAILY_LIMIT = 40;

async function withinAgentLimit(db: Db, now = new Date()): Promise<boolean> {
  const key = `rule_agent_calls_${now.toISOString().slice(0, 10)}`;
  const [row] = await db.select().from(metaTable).where(eq(metaTable.key, key));
  const used = Number(row?.value ?? 0);
  if (used >= AGENT_DAILY_LIMIT) return false;
  await db
    .insert(metaTable)
    .values({ key, value: String(used + 1) })
    .onConflictDoUpdate({ target: metaTable.key, set: { value: String(used + 1) } });
  return true;
}

export async function action(args: Route.ActionArgs) {
  const formData = await args.request.formData();
  const form = Object.fromEntries(formData);
  if (form.intent === "propose") return propose(String(form.wish ?? ""));
  const result = form.intent === "createMany" ? await createMany(formData) : await handle(form);
  await refreshInsights(getDb());
  return result;
}

/** The proposals of one sentence, saved together; one invalid entry saves none of them. */
async function createMany(formData: FormData) {
  const db = getDb();
  const get = (name: string) => formData.getAll(name).map(String);
  const [fields, matchTypes, patterns, categoryIds, priorities] = [
    get("field"),
    get("matchType"),
    get("pattern"),
    get("categoryId"),
    get("priority"),
  ];
  const parsed = patterns.map((pattern, i) =>
    ruleInputSchema.safeParse({
      field: fields[i],
      matchType: matchTypes[i],
      pattern,
      categoryId: categoryIds[i],
      priority: priorities[i] ?? 0,
    }),
  );
  const bad = parsed.find((p) => !p.success);
  if (bad || parsed.length === 0 || parsed.length > 5) {
    return data<ActionData>(
      { ok: false, message: bad?.error?.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  await db.insert(rules).values(parsed.map((p) => p.data as NonNullable<typeof p.data>));
  const changed = await reapplyRules(db);
  return data<ActionData>({
    ok: true,
    message: `${countLabel(parsed.length, "Regel", "Regeln")} gespeichert. ${countLabel(changed, "Buchung", "Buchungen")} jetzt fest per Regel zugeordnet.`,
  });
}

async function propose(wish: string) {
  const text = wish.trim().slice(0, 300);
  if (text.length < 3)
    return { proposals: [], message: "Schreib einfach, was wohin soll, z. B. „Lieferando ist Restaurant“." };
  const db = getDb();
  const [categories, existing, bookings] = await Promise.all([
    listCategories(db),
    listRules(db),
    db
      .select({
        counterparty: transactions.counterparty,
        purpose: transactions.purpose,
        amountCents: transactions.amountCents,
        bookingDate: transactions.bookingDate,
        categoryId: transactions.categoryId,
        categorySource: transactions.categorySource,
      })
      .from(transactions),
  ]);
  // The model only gets a turn when the sentence is not understood locally, and within a daily limit.
  let proposals = parseRuleWish(text, categories);
  if (proposals.length === 0) {
    const model = getModel();
    if (model && (await withinAgentLimit(db))) {
      proposals = await proposeRule(
        text,
        categories,
        bookings.map((b) => b.counterparty),
        model,
      );
    }
  }
  if (proposals.length === 0) {
    return {
      proposals: [],
      message:
        "Das habe ich nicht verstanden. Nenn den Händler und die Kategorie, z. B. „Thomann ist Hobbys“ oder „Netflix und Spotify sind Abos“.",
    };
  }
  return {
    proposals: proposals.map((proposal) => ({ proposal, preview: previewRule(proposal, bookings, existing) })),
  };
}

async function handle(form: Record<string, FormDataEntryValue>) {
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
    message: `Regel gespeichert. ${countLabel(changed, "Buchung", "Buchungen")} jetzt fest per Regel zugeordnet.`,
  });
}

const FIELD = { counterparty: "Empfänger", purpose: "Verwendungszweck" } as const;
const MATCH = { contains: "enthält", equals: "ist genau", regex: "passt auf den Ausdruck" } as const;

/** The rule as a sentence; "Empfänger enthält „x“" is what people can read without knowing the form. */
function RuleSentence({
  rule,
}: {
  rule: { field: keyof typeof FIELD; matchType: keyof typeof MATCH; pattern: string; categoryName: string };
}) {
  return (
    <p className="text-sm">
      Wenn der {FIELD[rule.field]} {MATCH[rule.matchType]} <strong>„{rule.pattern}“</strong> →{" "}
      <strong>{rule.categoryName}</strong>
    </p>
  );
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
    <fieldset disabled={disabled} className="grid min-w-0 gap-2 sm:grid-cols-[9rem_8rem_1fr_10rem_5rem]">
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

const EXAMPLES = ["Lieferando ist Restaurant", "Alles von Thomann ist Hobby", "Netflix und Spotify sind Abos"];

function previewText(preview: RulePreview): string {
  if (preview.matches === 0) return "Passt noch auf keine Buchung, greift aber bei künftigen.";
  const changes =
    preview.changes === 0
      ? "alle haben schon diese Kategorie"
      : `${countLabel(preview.changes, "bekommt", "bekommen")} dadurch die neue Kategorie`;
  return `Passt auf ${countLabel(preview.matches, "Buchung", "Buchungen")}, ${changes}.`;
}

/** One sentence in, finished rules out: what each does, how many bookings it hits, one click to keep them. */
function RuleAgent({ categories, demo }: { categories: { id: string; name: string }[]; demo: boolean }) {
  const fetcher = useFetcher<ActionData>();
  const inputRef = useRef<HTMLInputElement>(null);
  const [wish, setWish] = useState("");
  // Hidden after "Übernehmen" or "Verwerfen" until the next sentence.
  const [dismissed, setDismissed] = useState(false);
  const busy = fetcher.state !== "idle";
  // While a new answer loads, the old proposal is gone, so nobody saves it by accident.
  const result = !dismissed && !busy && fetcher.data && "proposals" in fetcher.data ? fetcher.data : null;
  const items = result?.proposals ?? [];
  // Fresh inputs for each answer; otherwise a select keeps the category of an earlier proposal for the same payee.
  const answerKey = items.map((i) => `${i.proposal.pattern}:${i.proposal.categoryId}:${i.preview.priority}`).join("|");

  function ask(text: string) {
    setWish(text);
    setDismissed(false);
    fetcher.submit({ intent: "propose", wish: text }, { method: "post" });
  }

  // A fresh proposal is the next thing to look at.
  useEffect(() => {
    if (items.length > 0) document.getElementById("rule-proposal")?.focus();
  }, [items.length]);

  return (
    <section aria-labelledby="new-rule" className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
      <div className="space-y-1">
        <h2 id="new-rule" className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4" aria-hidden="true" />
          Neue Regel
        </h2>
        <p className="text-sm text-muted-foreground">
          Sag einfach, was wohin gehört. Die App macht daraus eine Regel und zeigt vorher, was sie ändert.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          ask(wish);
        }}
      >
        <Input
          ref={inputRef}
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          placeholder="z. B. Lieferando ist immer Restaurant"
          aria-label="Was soll die Regel tun?"
          maxLength={300}
          disabled={demo}
          className="h-11 flex-1 text-base"
        />
        <Button type="submit" className="h-11" disabled={demo || busy || wish.trim().length < 3}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
          Vorschlag
        </Button>
      </form>
      {!result ? (
        <fieldset className="flex min-w-0 flex-wrap gap-2" aria-label="Beispiele">
          {EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              disabled={demo}
              onClick={() => ask(e)}
              className="rounded-full border px-3 py-1 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              {e}
            </button>
          ))}
        </fieldset>
      ) : null}
      {demo ? <p className="text-sm text-muted-foreground">In der Demo lassen sich keine Regeln anlegen.</p> : null}

      {result && items.length === 0 ? (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          {result.message}
        </p>
      ) : null}

      {items.length > 0 ? (
        <Form
          key={answerKey}
          method="post"
          id="rule-proposal"
          tabIndex={-1}
          onSubmit={() => setDismissed(true)}
          className="space-y-3 rounded-lg border bg-muted/40 p-4 outline-none"
          aria-label="Vorschlag"
          data-testid="rule-proposal"
        >
          <input type="hidden" name="intent" value="createMany" />
          <ul className="space-y-4">
            {items.map(({ proposal, preview }, i) => (
              <li key={proposal.pattern} className="space-y-2">
                <input type="hidden" name="field" value={proposal.field} />
                <input type="hidden" name="matchType" value={proposal.matchType} />
                <input type="hidden" name="priority" value={preview.priority} />
                <RuleSentence rule={proposal} />
                <p className="text-sm" data-testid="rule-preview">
                  {previewText(preview)}
                </p>
                {preview.examples.length > 0 ? (
                  <ul className="space-y-1 text-sm text-muted-foreground">
                    {preview.examples.map((e) => (
                      <li
                        key={`${e.bookingDate}-${e.counterparty}-${e.amountCents}`}
                        className="flex justify-between gap-2"
                      >
                        <span className="min-w-0 truncate">
                          {formatDate(e.bookingDate)} · {e.counterparty}
                        </span>
                        <Amount cents={e.amountCents} />
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1 text-sm">
                    <label htmlFor={`proposal-pattern-${i}`} className="block">
                      Text, nach dem gesucht wird
                    </label>
                    <Input
                      id={`proposal-pattern-${i}`}
                      name="pattern"
                      defaultValue={proposal.pattern}
                      required
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-1 text-sm">
                    <label htmlFor={`proposal-category-${i}`} className="block">
                      Kategorie
                    </label>
                    <select
                      id={`proposal-category-${i}`}
                      name="categoryId"
                      defaultValue={proposal.categoryId}
                      className={`${fieldClass} w-full`}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">{items.length === 1 ? "Übernehmen" : `Alle ${items.length} übernehmen`}</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDismissed(true);
                setWish("");
                inputRef.current?.focus();
              }}
            >
              Verwerfen
            </Button>
            <span className="text-xs text-muted-foreground">
              {items[0]?.proposal.source === "lokal" ? "verstanden ohne KI" : "mit KI verstanden"}
            </span>
          </div>
        </Form>
      ) : null}
    </section>
  );
}

export default function Regeln({ loaderData, actionData }: Route.ComponentProps) {
  const { rules: ruleRows, categories, demo } = loaderData;
  const result = actionData && "ok" in actionData ? actionData : undefined;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Regeln</h1>
        <p className="text-sm text-muted-foreground">
          Regeln ordnen Buchungen automatisch zu, bevor die KI gefragt wird. Von Hand gesetzte Kategorien ändern sie
          nie.
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

      <RuleAgent categories={categories} demo={demo} />

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Regel selbst einstellen (für Profis)</summary>
        <section aria-label="Regel selbst einstellen" className="mt-3">
          <Form method="post" className="space-y-3">
            <input type="hidden" name="intent" value="create" />
            <RuleFields prefix="new" categories={categories} disabled={demo} />
            <Button type="submit" disabled={demo}>
              Regel anlegen
            </Button>
          </Form>
        </section>
      </details>

      <section className="space-y-3">
        <h2 className="font-semibold">Deine Regeln ({ruleRows.length})</h2>
        {ruleRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine. Oben einen Satz eingeben oder in „Buchungen“ eine Kategorie ändern, dann bietet die App eine
            Regel an.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {ruleRows.map((rule) => (
              <li key={rule.id} className="space-y-2 p-3" data-testid="rule">
                <RuleSentence rule={rule} />
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground">Bearbeiten</summary>
                  <Form method="post" className="mt-3 space-y-3" aria-label={`Regel ${rule.pattern}`}>
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
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
