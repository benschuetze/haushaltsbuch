// Vercel "ignoreCommand": exit 0 skips the build, exit 1 builds.
// The private instance builds only for production: a preview would get a copy of the database,
// and with bank sync that means real account data in every preview. The demo (made-up data) previews as usual.
const preview = process.env.VERCEL_ENV === "preview";
const demo = process.env.DEMO_MODE === "true";
if (preview && !demo) {
  console.log("Preview der privaten Instanz übersprungen (keine Kopien echter Daten).");
  process.exit(0);
}
process.exit(1);
