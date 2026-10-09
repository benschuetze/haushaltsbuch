import { formatCents } from "~/lib/money";
import { type Booking, detectRecurring, type Recurring, serviceGroupOf } from "./recurring";

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
    | "fees";
  title: string;
  body: string;
  savingsCentsPerYear: number | null;
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
};

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

/** Pure: everything is derived from bookings and budgets, so it can be tested without a database. */
export function computeInsights(input: InsightInput, recurring?: Recurring[]): InsightDraft[] {
  const { month } = input;
  const drafts: InsightDraft[] = [];
  const spent = spentByCategory(input.bookings, month);

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
      const projected = Math.round((used / input.dayOfMonth) * input.daysInMonth);
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

  const reference = input.bookings.reduce((max, b) => (b.bookingDate > max ? b.bookingDate : max), `${month}-01`);
  const all = recurring ?? detectRecurring(input.bookings, reference);
  const subscriptions = all.filter((r) => r.active && r.kind === "subscription");
  if (subscriptions.length > 0) {
    const yearly = subscriptions.reduce((s, r) => s + r.yearlyCents, 0);
    const list = subscriptions
      .slice(0, 6)
      .map((r) => `${r.merchant} (${euro(r.yearlyCents)}/Jahr)`)
      .join(", ");
    drafts.push({
      key: `subscriptions:${month}`,
      kind: "subscriptions",
      title: `${subscriptions.length} laufende Abos: ${euro(yearly)} im Jahr`,
      body: `${list}${subscriptions.length > 6 ? " und weitere" : ""}. Alles noch in Gebrauch?`,
      savingsCentsPerYear: null,
      month,
    });
  }

  for (const r of all) {
    if (!r.active || r.previousAmountCents === null) continue;
    const before = Math.abs(r.previousAmountCents);
    const now = Math.abs(r.lastAmountCents);
    if (now <= before * 1.03 || monthOf(r.lastDate) < month) continue;
    const perYear = r.yearlyCents - (r.yearlyCents / now) * before;
    drafts.push({
      key: `price:${r.merchant.toLowerCase()}:${r.lastDate}`,
      kind: "price_increase",
      title: `${r.merchant} ist teurer geworden`,
      body: `Von ${euro(before)} auf ${euro(now)}, das sind ${euro(perYear)} mehr im Jahr. Kündigen oder günstigeren Tarif prüfen?`,
      savingsCentsPerYear: Math.round(perYear),
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
