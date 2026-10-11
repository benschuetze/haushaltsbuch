import { formatDate } from "~/lib/format";
import { formatCents } from "~/lib/money";
import { type Cancellation, cancellationStatus } from "~/lib/subscriptions/status";
import { type Booking, detectRecurring, merchantKey, merchantOf, type Recurring, serviceGroupOf } from "./recurring";

export type BudgetInput = { categoryId: string; categoryName: string; amountCents: number };

export type InsightDraft = {
  key: string;
  kind:
    | "budget_exceeded"
    | "budget_warning"
    | "subscriptions"
    | "price_increase"
    | "duplicate_service"
    | "spending_spike"
    | "fees"
    | "subscription_found"
    | "cancellation_failed"
    | "cancellation_confirmed";
  title: string;
  body: string;
  savingsCentsPerYear: number | null;
  /** Merchant the hint is about; lets the bell offer "Kündigen" in place. */
  subject?: string | null;
  month: string;
};

export type InsightInput = {
  bookings: (Booking & { categoryId: string | null; categoryKind: string | null })[];
  budgets: BudgetInput[];
  /** Month the hints are about: the current month if it has data, else the latest one. */
  month: string;
  /** Day of month counted as "today" for projections; null when the month is over. */
  dayOfMonth: number | null;
  daysInMonth: number;
  /** What the user said they cancelled; checked against later bookings. */
  cancellations?: Cancellation[];
  /** yyyy-mm-dd; defaults to the latest booking date. */
  today?: string;
};

const CADENCE = { weekly: "pro Woche", monthly: "im Monat", quarterly: "im Quartal", yearly: "im Jahr" } as const;

const FEE = /entgelt|gebühr|gebuehr|kontoführung|auslandseinsatz|\bfee\b|überziehungszins|sollzins/i;
const euro = (cents: number) => formatCents(Math.abs(cents)).replace(",00 €", " €");

function monthOf(date: string) {
  return date.slice(0, 7);
}

function spentByCategory(bookings: InsightInput["bookings"], month: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of bookings) {
    if (monthOf(b.bookingDate) !== month || !b.categoryId || b.categoryKind === "transfer") continue;
    // Refunds in a category reduce what was spent there.
    map.set(b.categoryId, (map.get(b.categoryId) ?? 0) - b.amountCents);
  }
  return map;
}

/**
 * Where a category's month will end. Fixed monthly payments (stable subscriptions, standing orders) count once
 * with their monthly amount; only the rest is extrapolated. Linear for everything made three subscriptions paid
 * by the 11th look like 95 € by month's end.
 */
export function projectSpend(input: {
  usedCents: number;
  categoryName: string;
  month: string;
  dayOfMonth: number;
  daysInMonth: number;
  bookings: Pick<Booking, "bookingDate" | "amountCents" | "counterparty" | "purpose" | "categoryName">[];
  recurring: Recurring[];
}): number {
  const fixed = input.recurring.filter(
    (r) => r.active && r.stable && r.cadence === "monthly" && r.categoryName === input.categoryName,
  );
  const fixedKeys = new Set(fixed.map((r) => merchantKey(r.merchant)));
  const fixedMonthlyCents = fixed.reduce((s, r) => s + Math.abs(r.lastAmountCents), 0);
  const paidFixedCents = input.bookings
    .filter(
      (b) =>
        b.bookingDate.startsWith(input.month) &&
        b.amountCents < 0 &&
        b.categoryName === input.categoryName &&
        fixedKeys.has(merchantKey(merchantOf(b))),
    )
    .reduce((s, b) => s - b.amountCents, 0);
  const variableCents = Math.max(0, input.usedCents - paidFixedCents);
  return Math.round(
    Math.max(fixedMonthlyCents, paidFixedCents) + (variableCents / input.dayOfMonth) * input.daysInMonth,
  );
}

/** Pure: everything is derived from bookings and budgets, so it can be tested without a database. */
export function computeInsights(input: InsightInput, recurring?: Recurring[]): InsightDraft[] {
  const { month } = input;
  const drafts: InsightDraft[] = [];
  const spent = spentByCategory(input.bookings, month);
  const reference = input.bookings.reduce((max, b) => (b.bookingDate > max ? b.bookingDate : max), `${month}-01`);
  const all = recurring ?? detectRecurring(input.bookings, reference);

  for (const budget of input.budgets) {
    const used = spent.get(budget.categoryId) ?? 0;
    const pct = Math.round((used / budget.amountCents) * 100);
    if (used > budget.amountCents) {
      drafts.push({
        key: `budget:${budget.categoryId}:${month}`,
        kind: "budget_exceeded",
        title: `Budget ${budget.categoryName} überschritten`,
        body: `${euro(used)} von ${euro(budget.amountCents)} ausgegeben (${pct} %), ${euro(used - budget.amountCents)} drüber.`,
        savingsCentsPerYear: null,
        month,
      });
    } else if (input.dayOfMonth !== null && input.dayOfMonth >= 7) {
      const projected = projectSpend({
        usedCents: used,
        categoryName: budget.categoryName,
        month,
        dayOfMonth: input.dayOfMonth,
        daysInMonth: input.daysInMonth,
        bookings: input.bookings,
        recurring: all,
      });
      if (projected > budget.amountCents * 1.05) {
        drafts.push({
          key: `budget:${budget.categoryId}:${month}`,
          kind: "budget_warning",
          title: `${budget.categoryName}: Budget wird knapp`,
          body: `Bisher ${euro(used)} von ${euro(budget.amountCents)}. Bei diesem Tempo landest du bei etwa ${euro(projected)}.`,
          savingsCentsPerYear: null,
          month,
        });
      }
    }
  }

  const today = input.today ?? reference;

  // Cancelled ones leave the subscription hints; a cancellation that did not stop the charges comes back loud.
  const stillCharging = new Set<string>();
  const cancelled = new Set<string>();
  for (const c of input.cancellations ?? []) {
    cancelled.add(c.merchantKey);
    const status = cancellationStatus(c, input.bookings, all, today);
    if (status.state === "failed") {
      stillCharging.add(c.merchantKey);
      drafts.push({
        key: `cancel-failed:${c.merchantKey}:${c.cancelledOn}`,
        kind: "cancellation_failed",
        title: `${c.merchant} bucht trotz Kündigung weiter ab`,
        body: `Gekündigt am ${formatDate(c.cancelledOn)}, am ${formatDate(status.chargedOn)} wurden trotzdem ${euro(status.amountCents)} abgebucht. Kündigungsbestätigung prüfen oder nochmal kündigen.`,
        savingsCentsPerYear: null,
        subject: c.merchant,
        month,
      });
    } else if (status.state === "confirmed") {
      drafts.push({
        key: `cancel-ok:${c.merchantKey}:${c.cancelledOn}`,
        kind: "cancellation_confirmed",
        title: `Kündigung von ${c.merchant} hat geklappt`,
        body: `Seit der Kündigung keine Abbuchung mehr.${status.yearlyCents ? ` Das spart ${euro(status.yearlyCents)} im Jahr.` : ""}`,
        savingsCentsPerYear: null,
        month,
      });
    }
  }
  const isCancelled = (r: Recurring) => {
    const key = merchantKey(r.merchant);
    return cancelled.has(key) && !stillCharging.has(key);
  };
  const subscriptions = all.filter((r) => r.active && r.kind === "subscription" && !isCancelled(r));

  // One hint for all of them: six "Abo erkannt" lines drowned the hints that need action. Cancelling one
  // by one happens on /abos.
  const listed = subscriptions.filter((r) => !stillCharging.has(merchantKey(r.merchant)));
  if (listed.length > 0) {
    const yearly = listed.reduce((s, r) => s + r.yearlyCents, 0);
    drafts.push({
      key: "abos",
      kind: "subscription_found",
      title: listed.length === 1 ? `1 Abo erkannt: ${listed[0]?.merchant}` : `${listed.length} Abos erkannt`,
      body: `${listed.map((r) => r.merchant).join(", ")}. Zusammen ${euro(-Math.round(yearly / 12))} im Monat, ${euro(-yearly)} im Jahr. Noch alle in Gebrauch? Unter „Abos“ lässt sich jedes einzeln kündigen.`,
      savingsCentsPerYear: null,
      subject: listed.length === 1 ? (listed[0]?.merchant ?? null) : null,
      month,
    });
  }
  for (const r of all) {
    if (!r.active || r.previousAmountCents === null || isCancelled(r)) continue;
    const before = Math.abs(r.previousAmountCents);
    const now = Math.abs(r.lastAmountCents);
    if (now <= before * 1.03 || monthOf(r.lastDate) < month) continue;
    const perYear = r.yearlyCents - (r.yearlyCents / now) * before;
    drafts.push({
      key: `price:${r.merchant.toLowerCase()}:${r.lastDate}`,
      kind: "price_increase",
      title: `${r.merchant} ist teurer geworden`,
      body: `Von ${euro(before)} auf ${euro(now)}, das sind ${euro(perYear)} mehr im Jahr. Kündigen oder günstigeren Tarif prüfen?`,
      // Extra cost, not money one could save: it does not count towards the savings total.
      savingsCentsPerYear: null,
      subject: r.merchant,
      month,
    });
  }

  const groups = new Map<string, Recurring[]>();
  for (const r of subscriptions) {
    const group = serviceGroupOf(r.merchant);
    if (group) groups.set(group, [...(groups.get(group) ?? []), r]);
  }
  for (const [group, members] of groups) {
    if (members.length < 2) continue;
    const cheapest = Math.min(...members.map((m) => m.yearlyCents));
    drafts.push({
      key: `duplicate:${group}:${month}`,
      kind: "duplicate_service",
      title: `${members.length}× ${group}`,
      body: `${members.map((m) => m.merchant).join(" und ")} laufen parallel. Wer einen davon kündigt, spart mindestens ${euro(cheapest)} im Jahr.`,
      savingsCentsPerYear: cheapest,
      month,
    });
  }

  // Compared with the average of up to three earlier months that have data.
  const months = [...new Set(input.bookings.map((b) => monthOf(b.bookingDate)))]
    .filter((m) => m < month)
    .sort()
    .slice(-3);
  if (months.length >= 2) {
    const names = new Map(input.bookings.map((b) => [b.categoryId, b.categoryName]));
    const history = months.map((m) => spentByCategory(input.bookings, m));
    for (const [categoryId, now] of spent) {
      const avg = history.reduce((s, h) => s + (h.get(categoryId) ?? 0), 0) / months.length;
      const kind = input.bookings.find((b) => b.categoryId === categoryId)?.categoryKind;
      if (kind === "income" || avg <= 0 || now < avg * 1.3 || now - avg < 5000) continue;
      drafts.push({
        key: `spike:${categoryId}:${month}`,
        kind: "spending_spike",
        title: `Mehr als sonst für ${names.get(categoryId) ?? "eine Kategorie"}`,
        body: `${euro(now)} in diesem Monat, sonst im Schnitt ${euro(avg)} (+${Math.round((now / avg - 1) * 100)} %).`,
        savingsCentsPerYear: null,
        month,
      });
    }
  }

  const fees = input.bookings.filter(
    (b) =>
      monthOf(b.bookingDate) === month &&
      b.amountCents < 0 &&
      (b.categoryName === "Gebühren" || FEE.test(`${b.counterparty} ${b.purpose}`)),
  );
  const feeTotal = fees.reduce((s, b) => s - b.amountCents, 0);
  if (feeTotal >= 100) {
    drafts.push({
      key: `fees:${month}`,
      kind: "fees",
      title: `${euro(feeTotal)} Bankgebühren diesen Monat`,
      body: `${fees.length === 1 ? "1 Buchung" : `${fees.length} Buchungen`} mit Gebühren oder Entgelten. Aufs Jahr gerechnet etwa ${euro(feeTotal * 12)}. Ein kostenloses Konto wäre eine Überlegung wert.`,
      savingsCentsPerYear: feeTotal * 12,
      month,
    });
  }

  return drafts;
}
