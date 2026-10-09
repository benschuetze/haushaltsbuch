import "dotenv/config";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { importDemoData } from "~/lib/db/demo-data";
import { seed } from "~/lib/db/seed";
import { refreshInsights } from "~/lib/insights";

const db = getDb();
await seed(db);
console.log("Standardkategorien und Demo-Konto angelegt");

// The public demo is read-only, so its data has to be there before the first visitor arrives.
if (process.env.DEMO_MODE === "true") {
  const inserted = await importDemoData(db, getModel());
  console.log(`Demo-Daten: ${inserted} neue Buchungen`);
}
// Runs on every deploy: hints computed by an older version of the logic must not linger for hours.
await refreshInsights(db);
console.log("Hinweise neu berechnet");
process.exit(0);
