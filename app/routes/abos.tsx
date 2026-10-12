import { and, eq } from "drizzle-orm";
import { Scissors } from "lucide-react";
import { useState } from "react";
import { data, Form } from "react-router";
import { z } from "zod";
import { Amount } from "~/components/amount";
import { CancelDialog, type CancelTarget } from "~/components/cancel-dialog";
import { Button } from "~/components/ui/button";
import { isReadOnly } from "~/lib/auth.server";
import { type Db, getDb } from "~/lib/db/client";
import { transactions } from "~/lib/db/schema";
import { formatDate } from "~/lib/format";
import { subscriptionOverview } from "~/lib/insights";
import { formatCents } from "~/lib/money";
import { markCancelled, undoCancellation } from "~/lib/subscriptions";
import { referencesFrom } from "~/lib/subscriptions/cancel-letter";
import { cancelLinkFor } from "~/lib/subscriptions/cancel-links";
import type { CancellationStatus } from "~/lib/subscriptions/status";
import type { Route } from "./+types/abos";

export const meta: Route.MetaFunction = () => [{ title: "Abos · Haushaltsbuch" }];

/**
 * Numbers the latest booking labels (customer, contract, member number, mandate reference) for a cancellation
 * letter. Read from that one booking, never guessed; only where no cancel page is known.
 */
async function letterHints(db: Db, r: { lastDate: string; lastAmountCents: number }) {
  const [last] = await db
    .select({ purpose: transactions.purpose, raw: transactions.raw, bookingDate: transactions.bookingDate })
    .from(transactions)
    .where(and(eq(transactions.bookingDate, r.lastDate), eq(transactions.amountCents, r.lastAmountCents)))
    .limit(1);
  if (!last) return null;
  return { ...referencesFrom(last.purpose, (last.raw ?? {}) as Record<string, unknown>), fromDate: last.bookingDate };
}

export async function loader() {
  const db = getDb();
  const overview = await subscriptionOverview(db);
  const recurring = await Promise.all(
    overview.recurring.map(async (r) => {
      const cancelLink = cancelLinkFor(r.merchant);
      return { ...r, cancelLink, letter: cancelLink.direct ? null : await letterHints(db, r) };
    }),
  );
  return {
    readOnly: isReadOnly(),
    recurring,
    cancellations: overview.cancellations.map((c) => ({ ...c, cancelLink: cancelLinkFor(c.merchant) })),
  };
}

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("cancel"), merchant: z.string().trim().min(1).max(200) }),
  z.object({ intent: z.literal("undo"), merchantKey: z.string().min(1).max(200) }),
]);

export async function action({ request }: Route.ActionArgs) {
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data({ ok: false, message: "Ungültige Eingabe." }, { status: 400 });
  const db = getDb();
  if (parsed.data.intent === "undo") {
    await undoCancellation(db, parsed.data.merchantKey);
    return { ok: true, message: "Kündigung zurückgenommen." };
  }
  const { merchant } = parsed.data;
  await markCancelled(db, merchant);
  return {
    ok: true,
    message: `Notiert. Die App prüft ab jetzt jede neue Buchung: Bucht ${merchant} trotzdem ab, kommt sofort eine Warnung, sonst eine Bestätigung.`,
  };
}

const CADENCE = {
  weekly: "wöchentlich",
  monthly: "monatlich",
  quarterly: "vierteljährlich",
  yearly: "jährlich",
} as const;

type Item = Route.ComponentProps["loaderData"]["recurring"][number];

function List({ items, label, onCancel }: { items: Item[]; label: string; onCancel?: (t: CancelTarget) => void }) {
  return (
    <ul aria-label={label} className="divide-y rounded-lg border">
      {items.map((r) => {
        const raised =
          r.previousAmountCents !== null && Math.abs(r.lastAmountCents) > Math.abs(r.previousAmountCents) * 1.03;
        return (
          <li
            key={`${r.merchant}-${r.firstDate}`}
            className="flex flex-wrap items-center justify-between gap-2 p-3"
            data-testid="recurring"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="font-medium break-words">{r.merchant}</p>
              <p className="text-xs text-muted-foreground">
                {CADENCE[r.cadence]} · {r.categoryName ?? "ohne Kategorie"} · zuletzt {formatDate(r.lastDate)}
                {raised && r.previousAmountCents !== null
                  ? ` · teurer, vorher ${formatCents(Math.abs(r.previousAmountCents))}`
                  : ""}
              </p>
            </div>
            <div className="text-right">
              <Amount cents={r.lastAmountCents} className="font-medium" />
              <p className="text-xs text-muted-foreground">{formatCents(r.yearlyCents)} im Jahr</p>
            </div>
            {onCancel ? (
              <Button
                size="sm"
                variant="outline"
                aria-label={`${r.merchant} kündigen`}
                onClick={() =>
                  onCancel({ merchant: r.merchant, ...r.cancelLink, yearlyCents: r.yearlyCents, letter: r.letter })
                }
              >
                <Scissors aria-hidden="true" />
                Kündigen
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function Abos({ loaderData, actionData }: Route.ComponentProps) {
  const [target, setTarget] = useState<CancelTarget | null>(null);
  const { readOnly, cancellations } = loaderData;
  const current = loaderData.recurring.filter((r) => !r.cancelled);
  const active = current.filter((r) => r.active);
  const subscriptions = active.filter((r) => r.kind === "subscription");
  const fixed = active.filter((r) => r.kind === "fixed");
  const ended = current.filter((r) => !r.active);
  const yearly = subscriptions.reduce((s, r) => s + r.yearlyCents, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Abos und feste Kosten</h1>
        <p className="text-sm text-muted-foreground">
          Erkannt an regelmäßigen Zahlungen mit gleichem Betrag, auch wenn sie nicht als Abo kategorisiert sind.
        </p>
      </div>
      {actionData ? (
        <p role={actionData.ok ? "status" : "alert"} className="rounded-lg border bg-muted/50 p-4 text-sm">
          {actionData.message}
        </p>
      ) : null}
      {loaderData.recurring.length === 0 ? (
        <p className="rounded-lg border p-4">
          Noch nichts erkannt. Dafür braucht es Auszüge aus mindestens zwei Monaten.
        </p>
      ) : null}
      {subscriptions.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold" data-testid="subscriptions-total">
            Abos: {formatCents(Math.round(yearly / 12))} im Monat, {formatCents(yearly)} im Jahr
          </h2>
          <List items={subscriptions} label="Laufende Abos" onCancel={setTarget} />
        </section>
      ) : null}
      {cancellations.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Gekündigt</h2>
          <ul aria-label="Gekündigt" className="divide-y rounded-lg border">
            {cancellations.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3" data-testid="cancelled">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="font-medium break-words">{c.merchant}</p>
                  <p className="text-xs text-muted-foreground">gekündigt am {formatDate(c.cancelledOn)}</p>
                </div>
                <CancelState status={c.status} />
                {c.status.state === "failed" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTarget({ merchant: c.merchant, ...c.cancelLink })}
                  >
                    Nochmal kündigen
                  </Button>
                ) : null}
                <Form method="post">
                  <input type="hidden" name="merchantKey" value={c.merchantKey} />
                  <Button type="submit" name="intent" value="undo" size="sm" variant="ghost" disabled={readOnly}>
                    Zurücknehmen
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {fixed.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Feste Kosten</h2>
          <List items={fixed} label="Feste Kosten" />
        </section>
      ) : null}
      {ended.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Beendet oder pausiert</h2>
          <List items={ended} label="Beendet" />
        </section>
      ) : null}
      {target ? (
        <CancelDialog key={target.merchant} target={target} readOnly={readOnly} onClose={() => setTarget(null)} />
      ) : null}
    </div>
  );
}

function CancelState({ status }: { status: CancellationStatus }) {
  if (status.state === "failed")
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-900" data-testid="cancel-state">
        bucht weiter ab ({formatDate(status.chargedOn)})
      </span>
    );
  if (status.state === "confirmed")
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900" data-testid="cancel-state">
        bestätigt{status.yearlyCents ? `, spart ${formatCents(status.yearlyCents)}/Jahr` : ""}
      </span>
    );
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-xs" data-testid="cancel-state">
      wird geprüft bis {formatDate(status.expectedBy)}
    </span>
  );
}
