/**
 * Savings goals: how much to put aside per month, and what of that is still open in the current pay period.
 * The open part is reserved in the daily budget, so the money is gone before it can be spent.
 */
export type GoalInput = {
  id: string;
  name: string;
  targetCents: number;
  dueMonth: string | null;
  monthlyCents: number | null;
  /** merchantKey of the standing order that feeds the goal; its transfers are already among the deposits. */
  fundedBy: string | null;
  deposits: { amountCents: number; depositedOn: string }[];
};

export type GoalStatus = {
  id: string;
  name: string;
  targetCents: number;
  dueMonth: string | null;
  savedCents: number;
  remainingCents: number;
  /** The month's share; for a deadline it is spread evenly over the months left. */
  perMonthCents: number;
  monthsLeft: number | null;
  depositedThisPeriodCents: number;
  /** What this pay period still has to put aside; reserved in the daily budget. */
  stillToReserveCents: number;
  fundedBy: string | null;
  done: boolean;
};

function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
}

export function goalStatus(goal: GoalInput, today: string, periodStart: string): GoalStatus {
  const savedCents = goal.deposits.reduce((s, d) => s + d.amountCents, 0);
  const remainingCents = Math.max(0, goal.targetCents - savedCents);
  const depositedThisPeriodCents = goal.deposits
    .filter((d) => d.depositedOn >= periodStart)
    .reduce((s, d) => s + d.amountCents, 0);
  // The share is fixed at the start of the period: putting money aside today must not shrink today's quota.
  const remainingAtStart = Math.max(0, goal.targetCents - (savedCents - depositedThisPeriodCents));

  let perMonthCents = 0;
  let monthsLeft: number | null = null;
  if (goal.dueMonth) {
    monthsLeft = Math.max(1, monthIndex(goal.dueMonth) - monthIndex(today.slice(0, 7)) + 1);
    perMonthCents = Math.ceil(remainingAtStart / monthsLeft);
  } else {
    perMonthCents = Math.min(goal.monthlyCents ?? 0, remainingAtStart);
  }
  const done = remainingCents === 0;
  return {
    id: goal.id,
    name: goal.name,
    targetCents: goal.targetCents,
    dueMonth: goal.dueMonth,
    savedCents,
    remainingCents,
    perMonthCents: done ? 0 : perMonthCents,
    monthsLeft,
    depositedThisPeriodCents,
    stillToReserveCents: done ? 0 : Math.max(0, Math.min(perMonthCents, remainingCents) - depositedThisPeriodCents),
    fundedBy: goal.fundedBy,
    done,
  };
}

export type MonthFlow = { month: string; incomeCents: number; spentCents: number; savedCents: number };

export type PurchasePlan = {
  /** What is typically left at the end of a month, after spending, savings transfers and goals. */
  surplusPerMonthCents: number;
  /** Months of putting the surplus aside until the amount is together; null when nothing is left over. */
  months: number | null;
  /** yyyy-mm in which it would be affordable. */
  month: string | null;
};

/**
 * "When can I afford 1.200 €?" From the average of the last full months: income minus spending minus what
 * went to own savings, minus the goals' monthly shares. What is free right now counts as a head start.
 */
export function planPurchase(
  history: MonthFlow[],
  amountCents: number,
  today: string,
  freeNowCents: number,
  goalsPerMonthCents: number,
): PurchasePlan {
  const current = today.slice(0, 7);
  const full = history.filter((h) => h.month < current).slice(-3);
  const avg =
    full.length > 0
      ? Math.round(full.reduce((s, h) => s + h.incomeCents - h.spentCents - h.savedCents, 0) / full.length)
      : 0;
  const surplus = avg - goalsPerMonthCents;
  const missing = amountCents - Math.max(0, freeNowCents);
  if (missing <= 0) return { surplusPerMonthCents: surplus, months: 0, month: current };
  if (surplus <= 0) return { surplusPerMonthCents: surplus, months: null, month: null };
  const months = Math.ceil(missing / surplus);
  const index = monthIndex(current) + months;
  const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
  return { surplusPerMonthCents: surplus, months, month };
}
