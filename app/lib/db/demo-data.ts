import { readFileSync } from "node:fs";
import type { LanguageModel } from "ai";
import { eq, inArray, sql } from "drizzle-orm";
import { clockNow } from "~/lib/clock";
import type { Db } from "~/lib/db/client";
import { accounts, imports, transactions } from "~/lib/db/schema";
import { importAuto, importCsv } from "~/lib/import/run";
import { DEMO_ACCOUNT } from "./seed";

export const DEMO_FILES = {
  // August and September: hand-checked sums in erwartet.json.
  main: "beispieldaten/demo-umsaetze.csv",
  // April–July and early October, plus PayPal: enough history for subscriptions, price changes and trends.
  history: "beispieldaten/demo-verlauf/girokonto.csv",
  paypal: "beispieldaten/demo-verlauf/paypal.csv",
};

/** The example files are written for a "today" in this month: subscriptions run until early October 2026. */
export const DEMO_MONTH = "2026-10";

/**
 * Whole months between the example "today" and now. The demo moves its bookings along by this much, otherwise the
 * subscriptions look cancelled and the overview empties a few weeks after the files were written. Zero while the
 * calendar is still in October 2026, which is where the browser tests pin the clock.
 */
export function demoMonthShift(now = clockNow()): number {
  const [y, m] = now.toISOString().slice(0, 7).split("-").map(Number) as [number, number];
  const [dy, dm] = DEMO_MONTH.split("-").map(Number) as [number, number];
  return Math.max(0, (y - dy) * 12 + (m - dm));
}

/**
 * Fills the public demo. Runs on every deploy and imports each file once, so a second run inserts nothing
 * and asks no model; a new example file reaches an existing demo on the next deploy. Freshly imported rows are
 * shifted to the current calendar (see demoMonthShift); rows from an earlier run keep their dates until the
 * nightly reset imports everything again.
 */
export async function importDemoData(
  db: Db,
  model: LanguageModel | null,
  // From disk on deploy; the running demo has the files bundled, see demo-reset.server.ts.
  read: (path: string) => Uint8Array = (path) => new Uint8Array(readFileSync(path)),
  now = clockNow(),
): Promise<number> {
  const [account] = await db.select().from(accounts).where(eq(accounts.name, DEMO_ACCOUNT.name));
  if (!account) throw new Error("Demo-Konto fehlt");
  // One import entry per file, not one more on every deploy.
  const done = new Set((await db.select({ filename: imports.filename }).from(imports)).map((i) => i.filename));
  let inserted = 0;
  const fresh: string[] = [];
  for (const path of [DEMO_FILES.main, DEMO_FILES.history]) {
    const filename = path.split("/").at(-1) ?? path;
    if (done.has(filename)) continue;
    inserted += (await importCsv(db, { accountId: account.id, filename, bytes: read(path), model })).inserted;
    fresh.push(filename);
  }
  if (!done.has("demo-paypal.csv")) {
    inserted += (await importAuto(db, { filename: "demo-paypal.csv", bytes: read(DEMO_FILES.paypal), model })).inserted;
    fresh.push("demo-paypal.csv");
  }
  const shift = demoMonthShift(now);
  if (shift > 0 && fresh.length > 0) {
    // Postgres clamps the day (31 July + 1 month = 31 August, 31 August + 1 month = 30 September).
    await db
      .update(transactions)
      .set({ bookingDate: sql`(${transactions.bookingDate} + make_interval(months => ${shift}))::date` })
      .where(
        inArray(
          transactions.importId,
          db.select({ id: imports.id }).from(imports).where(inArray(imports.filename, fresh)),
        ),
      );
  }
  return inserted;
}
