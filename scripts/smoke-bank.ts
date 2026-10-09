/**
 * Runs in the production build after the AI check. Without bank configuration there is nothing to check;
 * with it, a wrong key fails the build so the working version stays online.
 */
import "dotenv/config";
import { bankClient } from "~/lib/bank/index.server";
import { bankSmokeTest } from "~/lib/bank/smoke";

const production = process.env.VERCEL_ENV === "production" || process.argv.includes("--force");
const client = bankClient();
if (!production || !client) {
  console.log(
    `Bank-Selbsttest übersprungen (${!production ? "kein Produktions-Build" : "keine Bankanbindung eingerichtet"})`,
  );
  process.exit(0);
}
const { problems, warnings, banks } = await bankSmokeTest(client);
for (const w of warnings) console.warn(`Bank-Selbsttest, Hinweis: ${w}`);
if (problems.length > 0) {
  console.error(`Bank-Selbsttest fehlgeschlagen:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Bank-Selbsttest bestanden${banks ? `: ${banks} Banken abrufbar` : ""}, Verschlüsselung funktioniert.`);
