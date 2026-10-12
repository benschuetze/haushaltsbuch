/**
 * A standing order to one's own savings account is a goal the user already pursues, just without a name.
 * Only the same amount to the same counterparty in at least two months in a row counts (as the daily budget
 * treats a savings transfer), and the last one must be recent: one transfer or an order that stopped is no plan.
 */
export type SavingsTransfer = { counterparty: string; amountCents: number; bookingDate: string };
export type SavingsPlan = { counterparty: string; monthlyCents: number; months: number };

const MIN_MONTHS = 2;

function monthIndex(date: string): number {
  return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
}

/** `transfers` are outgoing bookings in a transfer category; amounts are negative. */
export function detectSavingsPlan(transfers: SavingsTransfer[], today: string): SavingsPlan | null {
  const groups = new Map<string, { counterparty: string; cents: number; months: Set<number> }>();
  for (const t of transfers) {
    if (t.amountCents >= 0) continue;
    const key = `${t.counterparty.trim().toLowerCase()}|${t.amountCents}`;
    const group = groups.get(key) ?? { counterparty: t.counterparty.trim(), cents: -t.amountCents, months: new Set() };
    group.months.add(monthIndex(t.bookingDate));
    groups.set(key, group);
  }
  const now = monthIndex(today);
  let best: SavingsPlan | null = null;
  for (const g of groups.values()) {
    const last = Math.max(...g.months);
    // This month's order may simply not be due yet.
    if (now - last > 1) continue;
    let run = 0;
    while (g.months.has(last - run)) run++;
    if (run < MIN_MONTHS) continue;
    if (!best || g.cents > best.monthlyCents)
      best = { counterparty: g.counterparty, monthlyCents: g.cents, months: run };
  }
  return best;
}
