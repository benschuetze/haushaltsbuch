import { eq, isNull } from "drizzle-orm";
import { data, Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import { Amount } from "~/components/amount";
import { SourceBadges } from "~/components/source-badge";
import { Button } from "~/components/ui/button";
import { isDemo } from "~/lib/auth.server";
import { categorizeOpen, confirmTransaction, reapplyRules, setManualCategory } from "~/lib/categorize/apply";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { rules, transactions } from "~/lib/db/schema";
import { countLabel, formatDate, formatMonth } from "~/lib/format";
import { listCategories, listTransactions, MONTH_PATTERN, monthsWithData } from "~/lib/queries";
import type { Route } from "./+types/transaktionen";

export const meta: Route.MetaFunction = () => [{ title: "Buchungen · Haushaltsbuch" }];

const filterSchema = z.object({
  monat: z.string().regex(MONTH_PATTERN).optional().catch(undefined),
  kategorie: z
    .union([z.literal("none"), z.uuid()])
    .optional()
    .catch(undefined),
  pruefen: z.literal("1").optional().catch(undefined),
});

export async function loader({ request }: Route.LoaderArgs) {
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filter = filterSchema.parse(params);
  const db = getDb();
  const [rows, categories, months, uncategorized] = await Promise.all([
    listTransactions(db, { month: filter.monat, categoryId: filter.kategorie, review: filter.pruefen === "1" }),
    listCategories(db),
    monthsWithData(db),
    db.$count(transactions, isNull(transactions.categoryId)),
  ]);
  return { rows, categories, months, filter, uncategorized, demo: isDemo() };
}

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("setCategory"), transactionId: z.uuid(), categoryId: z.uuid() }),
  z.object({ intent: z.literal("confirm"), transactionId: z.uuid() }),
  z.object({ intent: z.literal("createRule"), transactionId: z.uuid(), categoryId: z.uuid() }),
  z.object({ intent: z.literal("categorizeOpen") }),
]);

type ActionData =
  | { kind: "suggestRule"; transactionId: string; counterparty: string; categoryId: string; categoryName: string }
  | { kind: "ruleCreated"; counterparty: string; categoryName: string; changed: number }
  | { kind: "categorized"; open: number; byRule: number; byAi: number; needsReview: number }
  | { kind: "error"; message: string };

export async function action({ request }: Route.ActionArgs) {
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data<ActionData>({ kind: "error", message: "Ungültige Eingabe." }, { status: 400 });
  const input = parsed.data;
  const db = getDb();

  if (input.intent === "categorizeOpen") {
    const stats = await categorizeOpen(db, getModel());
    return data<ActionData>({ kind: "categorized", ...stats });
  }

  const [tx] = await db.select().from(transactions).where(eq(transactions.id, input.transactionId));
  if (!tx) return data<ActionData>({ kind: "error", message: "Buchung nicht gefunden." }, { status: 404 });

  if (input.intent === "confirm") {
    await confirmTransaction(db, tx.id);
    return null;
  }

  const categories = await listCategories(db);
  const category = categories.find((c) => c.id === input.categoryId);
  if (!category) return data<ActionData>({ kind: "error", message: "Kategorie nicht gefunden." }, { status: 400 });

  if (input.intent === "setCategory") {
    await setManualCategory(db, tx.id, category.id);
    return data<ActionData>({
      kind: "suggestRule",
      transactionId: tx.id,
      counterparty: tx.counterparty,
      categoryId: category.id,
      categoryName: category.name,
    });
  }

  await db.insert(rules).values({
    field: "counterparty",
    matchType: "equals",
    pattern: tx.counterparty,
    categoryId: category.id,
    createdFromTransactionId: tx.id,
  });
  const changed = await reapplyRules(db);
  return data<ActionData>({ kind: "ruleCreated", counterparty: tx.counterparty, categoryName: category.name, changed });
}

const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";

export default function Transaktionen({ loaderData, actionData }: Route.ComponentProps) {
  const { rows, categories, months, filter, demo } = loaderData;
  const busy = useNavigation().state !== "idle";
  const result = actionData as ActionData | null | undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Buchungen</h1>

      <Form method="get" className="flex flex-wrap items-end gap-3" aria-label="Buchungen filtern">
        <label className="space-y-1 text-sm">
          <span className="block">Monat</span>
          <select name="monat" defaultValue={filter.monat ?? ""} className={selectClass}>
            <option value="">Alle</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block">Kategorie</span>
          <select name="kategorie" defaultValue={filter.kategorie ?? ""} className={selectClass}>
            <option value="">Alle</option>
            <option value="none">Ohne Kategorie</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="pruefen" value="1" defaultChecked={filter.pruefen === "1"} className="size-4" />
          Nur „prüfen“
        </label>
        <Button type="submit" variant="outline">
          Filtern
        </Button>
      </Form>

      {result?.kind === "suggestRule" && !demo ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 p-4 text-sm">
          <p className="min-w-0 flex-1">
            Regel für „{result.counterparty}“ anlegen? Alle Buchungen dieses Empfängers kommen dann in{" "}
            {result.categoryName}. Manuell gesetzte bleiben, wie sie sind.
          </p>
          <Form method="post" className="flex gap-2">
            <input type="hidden" name="intent" value="createRule" />
            <input type="hidden" name="transactionId" value={result.transactionId} />
            <input type="hidden" name="categoryId" value={result.categoryId} />
            <Button type="submit" size="sm">
              Regel anlegen
            </Button>
          </Form>
          <Button asChild size="sm" variant="ghost">
            <Link to="." replace>
              Nein, danke
            </Link>
          </Button>
        </div>
      ) : null}
      {result?.kind === "ruleCreated" ? (
        <p role="status" className="rounded-lg border bg-muted/50 p-4 text-sm">
          Regel angelegt: „{result.counterparty}“ → {result.categoryName}.{" "}
          {countLabel(result.changed, "Buchung", "Buchungen")} umkategorisiert.
        </p>
      ) : null}
      {result?.kind === "categorized" ? (
        <p role="status" className="rounded-lg border bg-muted/50 p-4 text-sm">
          {countLabel(result.byRule + result.byAi, "Buchung", "Buchungen")} zugeordnet
          {result.byRule > 0 ? ` (${result.byRule} per Regel)` : ""}.
          {result.needsReview > 0
            ? ` ${countLabel(result.needsReview, "Buchung bleibt", "Buchungen bleiben")} zum Prüfen.`
            : ""}
        </p>
      ) : null}
      {loaderData.uncategorized > 0 && !demo && result?.kind !== "categorized" ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm">
          <p className="min-w-0 flex-1">
            {countLabel(loaderData.uncategorized, "Buchung hat", "Buchungen haben")} noch keine Kategorie.
          </p>
          <Form method="post">
            <input type="hidden" name="intent" value="categorizeOpen" />
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? "Ordne zu …" : "Jetzt zuordnen"}
            </Button>
          </Form>
        </div>
      ) : null}
      {result?.kind === "error" ? (
        <p role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">
          {result.message}
        </p>
      ) : null}

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {countLabel(rows.length, "Buchung", "Buchungen")}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-lg border p-4">Keine Buchungen für diesen Filter.</p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Buchungen">
          {rows.map((tx) => (
            <li
              key={tx.id}
              className="grid gap-2 p-3 sm:grid-cols-[6rem_1fr_auto] sm:items-start"
              data-testid="transaction"
            >
              <span className="text-sm text-muted-foreground tabular-nums">{formatDate(tx.bookingDate)}</span>
              <div className="min-w-0 space-y-1">
                <p className="font-medium break-words" data-testid="counterparty">
                  {tx.counterparty}
                </p>
                <p className="text-sm text-muted-foreground break-words">{tx.purpose}</p>
                <SourceBadges source={tx.categorySource} confidence={tx.aiConfidence} needsReview={tx.needsReview} />
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <Amount cents={tx.amountCents} className="font-medium" />
                <Form method="post" className="flex flex-wrap gap-2">
                  <input type="hidden" name="intent" value="setCategory" />
                  <input type="hidden" name="transactionId" value={tx.id} />
                  <label className="sr-only" htmlFor={`cat-${tx.id}`}>
                    Kategorie für {tx.counterparty} am {formatDate(tx.bookingDate)}
                  </label>
                  <select
                    id={`cat-${tx.id}`}
                    name="categoryId"
                    defaultValue={tx.categoryId ?? ""}
                    key={tx.categoryId ?? "none"}
                    required
                    disabled={demo}
                    className={selectClass}
                  >
                    <option value="" disabled>
                      Kategorie wählen
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm" variant="outline" disabled={demo || busy}>
                    Ändern
                  </Button>
                </Form>
                {tx.needsReview && tx.categoryId ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="confirm" />
                    <input type="hidden" name="transactionId" value={tx.id} />
                    <Button type="submit" size="sm" disabled={demo || busy}>
                      Bestätigen
                    </Button>
                  </Form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
