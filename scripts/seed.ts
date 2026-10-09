import "dotenv/config";
import { getDb } from "~/lib/db/client";
import { seed } from "~/lib/db/seed";

await seed(getDb());
console.log("Standardkategorien und Demo-Konto angelegt");
process.exit(0);
