import { asc, eq } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { savingsDeposits, savingsGoals } from "~/lib/db/schema";
import type { GoalInput } from "./goals";

export async function loadGoalInputs(db: Db, { includeAchieved = false } = {}): Promise<GoalInput[]> {
  const [goals, deposits] = await Promise.all([
    db.select().from(savingsGoals).orderBy(asc(savingsGoals.createdAt)),
    db.select().from(savingsDeposits),
  ]);
  return goals
    .filter((g) => includeAchieved || g.achievedAt === null)
    .map((g) => ({
      id: g.id,
      name: g.name,
      targetCents: g.targetCents,
      dueMonth: g.dueMonth,
      monthlyCents: g.monthlyCents,
      deposits: deposits
        .filter((d) => d.goalId === g.id)
        .map((d) => ({ amountCents: d.amountCents, depositedOn: d.depositedOn })),
    }));
}

export async function createGoal(
  db: Db,
  input: { name: string; targetCents: number; dueMonth: string | null; monthlyCents: number | null },
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
