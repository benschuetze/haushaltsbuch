import { readFileSync } from "node:fs";
import type { LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { accounts, imports } from "~/lib/db/schema";
import { importAuto, importCsv } from "~/lib/import/run";
import { DEMO_ACCOUNT } from "./seed";

const FILES = {
  // August and September: hand-checked sums in erwartet.json.
  main: "beispieldaten/demo-umsaetze.csv",
  // April–July and early October, plus PayPal: enough history for subscriptions, price changes and trends.
  history: "beispieldaten/demo-verlauf/girokonto.csv",
  paypal: "beispieldaten/demo-verlauf/paypal.csv",
};

/**
 * Fills the public demo. Runs on every deploy and imports each file once, so a second run inserts nothing
 * and asks no model; a new example file reaches an existing demo on the next deploy.
 */
export async function importDemoData(db: Db, model: LanguageModel | null): Promise<number> {
  const [account] = await db.select().from(accounts).where(eq(accounts.name, DEMO_ACCOUNT.name));
  if (!account) throw new Error("Demo-Konto fehlt");
  const read = (path: string) => new Uint8Array(readFileSync(path));
  // One import entry per file, not one more on every deploy.
  const done = new Set((await db.select({ filename: imports.filename }).from(imports)).map((i) => i.filename));
  let inserted = 0;
  for (const path of [FILES.main, FILES.history]) {
    const filename = path.split("/").at(-1) ?? path;
    if (done.has(filename)) continue;
    inserted += (await importCsv(db, { accountId: account.id, filename, bytes: read(path), model })).inserted;
  }
  if (!done.has("demo-paypal.csv")) {
    inserted += (await importAuto(db, { filename: "demo-paypal.csv", bytes: read(FILES.paypal), model })).inserted;
  }
  return inserted;
}
