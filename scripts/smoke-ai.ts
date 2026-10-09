/**
 * Runs in the production build before deploying: a real, tiny request on both LLM paths.
 * If the key, workspace or model is wrong, the build fails and the working version stays online.
 */
import "dotenv/config";
import { getModel } from "~/lib/categorize/model";
import { aiSmokeTest } from "~/lib/categorize/smoke";

const production = process.env.VERCEL_ENV === "production" || process.argv.includes("--force");
if (!production) {
  console.log("KI-Selbsttest übersprungen (kein Produktions-Build)");
  process.exit(0);
}
if (process.env.AI_MOCK === "1") {
  console.log("KI-Selbsttest übersprungen (AI_MOCK=1, z. B. Demo)");
  process.exit(0);
}
const model = getModel();
if (!model) {
  console.error("KI-Selbsttest: ANTHROPIC_API_KEY fehlt in der Produktion. Ohne Key landet jede Buchung in „prüfen“.");
  process.exit(1);
}
const problems = await aiSmokeTest(model);
if (problems.length > 0) {
  console.error(`KI-Selbsttest fehlgeschlagen:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("KI-Selbsttest bestanden: Kategorisierung und Spaltenzuordnung antworten.");
