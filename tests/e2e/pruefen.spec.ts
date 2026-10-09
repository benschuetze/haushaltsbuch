import { expect, test } from "@playwright/test";
import { importDemo, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

test("Filter „prüfen“ zeigt nur unsichere Buchungen, Bestätigen nimmt sie heraus", async ({ page }) => {
  await importDemo(page);
  // The mock model is unsure about Zalando (via PayPal) and dm: 3 bookings in the demo data.
  await expect(page.getByTestId("import-needs-review")).toHaveText("3");

  await page.goto("/transaktionen");
  await page.getByLabel("Nur „prüfen“").check();
  await page.getByRole("button", { name: "Filtern" }).click();
  await expect(page).toHaveURL(/pruefen=1/);

  const rows = page.getByTestId("transaction");
  await expect(rows).toHaveCount(3);
  for (const row of await rows.all()) {
    await expect(row.getByText("prüfen", { exact: true })).toBeVisible();
  }

  const zalando = rows.filter({ hasText: "Zalando" });
  await zalando.getByRole("button", { name: "Bestätigen" }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Zalando" })).toHaveCount(0);

  // Counts everything still open, like the bell: the dm bookings from August and September.
  await page.goto("/");
  await expect(page.getByTestId("review-count")).toHaveText("2");
});

test("Buchungen, die beim Import ohne Kategorie blieben, lassen sich nachträglich zuordnen", async ({ page }) => {
  await importDemo(page);
  // Same state as an import while the model was unreachable.
  await sql(
    "update transactions set category_id = null, category_source = null, ai_confidence = null, needs_review = true where counterparty in ('REWE Markt', 'Lidl')",
  );
  await page.goto("/transaktionen");
  await expect(page.getByText("6 Buchungen haben noch keine Kategorie.")).toBeVisible();
  await page.getByRole("button", { name: "Jetzt zuordnen" }).click();
  await expect(page.getByRole("status")).toHaveText("6 Buchungen zugeordnet.");
  await expect(page.getByText("noch keine Kategorie")).toHaveCount(0);
});
