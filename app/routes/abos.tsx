import { Amount } from "~/components/amount";
import { getDb } from "~/lib/db/client";
import { formatDate } from "~/lib/format";
import { recurringPayments } from "~/lib/insights";
import type { Recurring } from "~/lib/insights/recurring";
import { formatCents } from "~/lib/money";
import type { Route } from "./+types/abos";

export const meta: Route.MetaFunction = () => [{ title: "Abos · Haushaltsbuch" }];

export async function loader() {
  return { recurring: await recurringPayments(getDb()) };
}

const CADENCE = {
  weekly: "wöchentlich",
  monthly: "monatlich",
  quarterly: "vierteljährlich",
  yearly: "jährlich",
} as const;

function List({ items, label }: { items: Recurring[]; label: string }) {
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
            <div className="min-w-0 space-y-0.5">
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
          </li>
        );
      })}
    </ul>
  );
}

export default function Abos({ loaderData }: Route.ComponentProps) {
  const active = loaderData.recurring.filter((r) => r.active);
  const subscriptions = active.filter((r) => r.kind === "subscription");
  const fixed = active.filter((r) => r.kind === "fixed");
  const ended = loaderData.recurring.filter((r) => !r.active);
  const yearly = subscriptions.reduce((s, r) => s + r.yearlyCents, 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Abos und feste Kosten</h1>
        <p className="text-sm text-muted-foreground">
          Erkannt an regelmäßigen Zahlungen mit gleichem Betrag, auch wenn sie nicht als Abo kategorisiert sind.
        </p>
      </div>
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
          <List items={subscriptions} label="Laufende Abos" />
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
    </div>
  );
}
