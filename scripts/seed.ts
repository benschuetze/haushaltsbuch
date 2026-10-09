import "dotenv/config";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { accounts, transactions } from "~/lib/db/schema";
import { DEMO_ACCOUNT, seed } from "~/lib/db/seed";
import { importCsv } from "~/lib/import/run";

const db = getDb();
await seed(db);
console.log("Standardkategorien und Demo-Konto angelegt");

// The public demo is read-only, so its data has to be there before the first visitor arrives.
if (process.env.DEMO_MODE === "true") {
  const [account] = await db.select().from(accounts).where(eq(accounts.name, DEMO_ACCOUNT.name));
  if (!account) throw new Error("Demo-Konto fehlt");
  if ((await db.$count(transactions)) === 0) {
    const result = await importCsv(db, {
      accountId: account.id,
      filename: "demo-umsaetze.csv",
      bytes: new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv")),
      model: getModel(),
    });
    console.log(`Demo-Daten importiert: ${result.inserted} Buchungen, ${result.needsReview} zu prüfen`);
  } else {
    console.log("Demo-Daten schon vorhanden");
  }
}
process.exit(0);
