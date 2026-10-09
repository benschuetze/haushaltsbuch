import { eq } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { subscriptionCancellations } from "~/lib/db/schema";
import { refreshInsights } from "~/lib/insights";
import { merchantKey } from "~/lib/insights/recurring";

/** Records the user's "done, cancelled" and lets the hints react at once. Saying it twice keeps the first date. */
export async function markCancelled(db: Db, merchant: string, now = new Date()): Promise<void> {
  const key = merchantKey(merchant);
  if (!key) throw new Error("Unbekannter Händler");
  await db
    .insert(subscriptionCancellations)
    .values({ merchantKey: key, merchant, cancelledOn: now.toISOString().slice(0, 10) })
    .onConflictDoNothing({ target: subscriptionCancellations.merchantKey });
  await refreshInsights(db, now);
}

export async function undoCancellation(db: Db, key: string, now = new Date()): Promise<void> {
  await db.delete(subscriptionCancellations).where(eq(subscriptionCancellations.merchantKey, key));
  await refreshInsights(db, now);
}

export async function listCancellations(db: Db) {
  return db.select().from(subscriptionCancellations).orderBy(subscriptionCancellations.cancelledOn);
}
