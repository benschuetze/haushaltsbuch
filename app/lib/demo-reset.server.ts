import { sql } from "drizzle-orm";
import { getModel } from "~/lib/categorize/model";
import { clockNow } from "~/lib/clock";
import type { Db } from "~/lib/db/client";
import { DEMO_FILES, importDemoData } from "~/lib/db/demo-data";
import { meta } from "~/lib/db/schema";
import { seed } from "~/lib/db/seed";
import { refreshInsights, todayInGermany } from "~/lib/insights";
import mainCsv from "../../beispieldaten/demo-umsaetze.csv?raw";
import historyCsv from "../../beispieldaten/demo-verlauf/girokonto.csv?raw";
import paypalCsv from "../../beispieldaten/demo-verlauf/paypal.csv?raw";

// Bundled: the running demo has no beispieldaten folder on disk, only the build did.
const BUNDLED: Record<string, string> = {
  [DEMO_FILES.main]: mainCsv,
  [DEMO_FILES.history]: historyCsv,
  [DEMO_FILES.paypal]: paypalCsv,
};
const read = (path: string): Uint8Array => {
  const text = BUNDLED[path];
  if (text === undefined) throw new Error(`Demo-Datei fehlt im Bundle: ${path}`);
  return new TextEncoder().encode(text);
};

/**
 * Everything a visitor can change, back to the example data. The daily model budgets in meta stay: resetting
 * must not hand out a fresh allowance of paid model calls.
 */
export async function resetDemo(db: Db): Promise<void> {
  // Plain deletes in foreign-key order rather than one TRUNCATE ... CASCADE: no table lock that waits on every other
  // open connection, which made the local test database fall over.
  for (const table of [
    "savings_deposits",
    "savings_goals",
    "subscription_cancellations",
    "insights",
    "budgets",
    "rules",
    "transactions",
    "imports",
    "bank_accounts",
    "bank_connections",
    "bank_auth_states",
    "bank_formats",
    "accounts",
    "categories",
  ]) {
    await db.execute(sql.raw(`delete from ${table}`));
  }
  // Lets seed() put the default budgets back.
  await db.delete(meta).where(sql`${meta.key} = 'default_budgets_seeded'`);
  await seed(db);
  await importDemoData(db, getModel(), read);
  await refreshInsights(db);
}

/** Name of the button's daily allowance. Not "demo_reset": that prefix is taken by the nightly claim. */
export const RESET_BUDGET = "demo_reset_button";

let checkedDay: string | null = null;

/**
 * Once a night the demo starts over, whatever visitors did the day before. The first request of the day claims the
 * reset with one insert; every other request (and every other server instance) sees the claim and moves on.
 */
export async function resetDemoNightly(db: Db, now = clockNow()): Promise<boolean> {
  // Off in the browser tests, where the demo server shares its database with every other test.
  if (process.env.DEMO_NIGHTLY_RESET === "0") return false;
  const day = todayInGermany(now);
  if (checkedDay === day) return false;
  const claimed = await db
    .insert(meta)
    .values({ key: `demo_reset_${day}`, value: now.toISOString() })
    .onConflictDoNothing()
    .returning();
  checkedDay = day;
  if (claimed.length === 0) return false;
  try {
    await resetDemo(db);
  } catch (error) {
    // Give the claim back, so the next request tries again instead of leaving a half-empty demo all day.
    await db.delete(meta).where(sql`${meta.key} = ${`demo_reset_${day}`}`);
    checkedDay = null;
    throw error;
  }
  return true;
}
