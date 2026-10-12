import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { categories, savingsDeposits, savingsGoals, transactions } from "~/lib/db/schema";
import { merchantKey } from "~/lib/insights/recurring";
import type { GoalInput } from "./goals";
import { detectSavingsPlan, type SavingsPlan } from "./savings-plan";

export async function loadGoalInputs(db: Db, { includeAchieved = false } = {}): Promise<GoalInput[]> {
  const [goals, deposits] = await Promise.all([
    db.select().from(savingsGoals).orderBy(asc(savingsGoals.createdAt)),
    db.select().from(savingsDeposits),
  ]);
  // The month a goal was set up counts in full: its transfer may have gone out a few days before.
  const since = (g: { createdAt: Date }) => `${g.createdAt.toISOString().slice(0, 7)}-01`;
  const funded = goals
    .filter((g) => g.fundedBy)
    .map(since)
    .sort();
  const transfers = funded[0] ? await outgoingTransfers(db, funded[0]) : [];
  return goals
    .filter((g) => includeAchieved || g.achievedAt === null)
    .map((g) => {
      const fromOrder = g.fundedBy
        ? transfers
            .filter((t) => t.bookingDate >= since(g) && merchantKey(t.counterparty) === g.fundedBy)
            .map((t) => ({ amountCents: -t.amountCents, depositedOn: t.bookingDate }))
        : [];
      return {
        id: g.id,
        name: g.name,
        targetCents: g.targetCents,
        dueMonth: g.dueMonth,
        monthlyCents: g.monthlyCents,
        fundedBy: g.fundedBy,
        deposits: [
          ...deposits
            .filter((d) => d.goalId === g.id)
            .map((d) => ({ amountCents: d.amountCents, depositedOn: d.depositedOn })),
          ...fromOrder,
        ],
      };
    });
}

function outgoingTransfers(db: Db, from: string) {
  return db
    .select({
      counterparty: transactions.counterparty,
      amountCents: transactions.amountCents,
      bookingDate: transactions.bookingDate,
    })
    .from(transactions)
    .innerJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(eq(categories.kind, "transfer"), lt(transactions.amountCents, 0), gte(transactions.bookingDate, from)));
}

export async function createGoal(
  db: Db,
  input: {
    name: string;
    targetCents: number;
    dueMonth: string | null;
    monthlyCents: number | null;
    fundedBy?: string | null;
  },
): Promise<string> {
  const [row] = await db.insert(savingsGoals).values(input).returning({ id: savingsGoals.id });
  if (!row) throw new Error("Sparziel konnte nicht angelegt werden");
  return row.id;
}

/** Records money put aside; returns true the moment the goal is reached, so the page can celebrate once. */
export async function deposit(db: Db, goalId: string, amountCents: number, today: string): Promise<boolean> {
  const [goal] = await db.select().from(savingsGoals).where(eq(savingsGoals.id, goalId));
  if (!goal) throw new Error("Sparziel nicht gefunden");
  await db.insert(savingsDeposits).values({ goalId, amountCents, depositedOn: today });
  const deposits = await db.select().from(savingsDeposits).where(eq(savingsDeposits.goalId, goalId));
  const saved = deposits.reduce((s, d) => s + d.amountCents, 0);
  if (goal.achievedAt === null && saved >= goal.targetCents) {
    await db.update(savingsGoals).set({ achievedAt: new Date() }).where(eq(savingsGoals.id, goalId));
    return true;
  }
  return false;
}

export async function deleteGoal(db: Db, goalId: string): Promise<void> {
  await db.delete(savingsGoals).where(eq(savingsGoals.id, goalId));
}

/** A standing order to savings in the last half year, if there is one; see detectSavingsPlan. */
export async function savingsPlan(db: Db, today: string): Promise<(SavingsPlan & { key: string }) | null> {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const from = new Date(Date.UTC(y, m - 1 - 6, 1)).toISOString().slice(0, 10);
  const plan = detectSavingsPlan(await outgoingTransfers(db, from), today);
  return plan ? { ...plan, key: merchantKey(plan.counterparty) } : null;
}
