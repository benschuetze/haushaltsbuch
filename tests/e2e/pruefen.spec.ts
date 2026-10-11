import { expect, test } from "./fixtures";
import { DEMO_URL, importDemo, resetDb, sql } from "./helpers";

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

test("Demo: Prüfen lässt sich ausprobieren, die Rückmeldung ist sofort im Bild, gespeichert wird nichts", async ({
  page,
}) => {
  // In tests the demo server reads the same database.
  await importDemo(page);
  await page.goto(`${DEMO_URL}/pruefen`);
  await expect(page.getByText("In der Demo kannst du hier alles ausprobieren")).toBeVisible();
  const first = await page.getByTestId("review-counterparty").textContent();
  const remaining = await page.getByTestId("review-remaining").textContent();

  // A category far down the grid: the answer must still be on screen, not above it.
  await page
    .getByRole("group", { name: /woanders hin|Wohin gehört/ })
    .getByRole("button", { name: "Mobilität" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Nur Demo" });
  await expect(dialog).toBeInViewport();
  await expect(dialog).toContainText(`„${first}“ wäre jetzt Mobilität`);
  await dialog.getByRole("button", { name: "Weiter" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("review-remaining")).not.toHaveText(remaining ?? "");

  await page.getByRole("button", { name: /^Passt:/ }).click();
  await expect(page.getByRole("dialog", { name: "Nur Demo" })).toBeInViewport();

  // Nothing was saved: the same bookings are still open.
  await page.goto(`${DEMO_URL}/pruefen`);
  await expect(page.getByTestId("review-counterparty")).toHaveText(first ?? "");
  await expect(page.getByTestId("review-remaining")).toHaveText(remaining ?? "");
});

test("Demo: in der Liste lassen sich Kategorie ändern und bestätigen ausprobieren", async ({ page }) => {
  await importDemo(page);
  await page.goto(`${DEMO_URL}/transaktionen?pruefen=1`);
  const row = page.getByRole("list", { name: "Buchungen" }).getByRole("listitem").first();
  await expect(row.getByRole("button", { name: "Bestätigen" })).toBeEnabled();
  await row.getByRole("button", { name: "Bestätigen" }).click();
  const dialog = page.getByRole("dialog", { name: "Nur Demo" });
  await expect(dialog).toBeInViewport();
  await expect(dialog).toContainText("Gespeichert wird hier nichts");
  await dialog.getByRole("button", { name: "Weiter" }).click();
  await expect(dialog).toHaveCount(0);
});
