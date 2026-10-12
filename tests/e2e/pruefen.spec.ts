import { expect, test } from "./fixtures";
import { DEMO_URL, importDemo, modelUnsureAboutDm, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

test("Filter „prüfen“ zeigt nur unsichere Buchungen, Bestätigen nimmt sie heraus", async ({ page }) => {
  await importDemo(page);
  // The mock model is unsure about Zalando (via PayPal); dm is known to the merchant list.
  await expect(page.getByTestId("import-needs-review")).toHaveText("1");
  await modelUnsureAboutDm();

  await page.goto("/buchungen");
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
  await page.goto("/buchungen");
  await expect(page.getByText("6 Buchungen haben noch keine Kategorie.")).toBeVisible();
  await page.getByRole("button", { name: "Jetzt zuordnen" }).click();
  // REWE and Lidl are on the built-in merchant list, so no model is needed for them.
  await expect(page.getByRole("status")).toHaveText("6 Buchungen zugeordnet (6 per Regel).");
  await expect(page.getByText("noch keine Kategorie")).toHaveCount(0);
});

test("Demo: Prüfen funktioniert echt, die Entscheidung bleibt bis zum Zurücksetzen", async ({ page }) => {
  // In tests the demo server reads the same database.
  await importDemo(page);
  await modelUnsureAboutDm();
  await page.goto(`${DEMO_URL}/pruefen`);
  const first = await page.getByTestId("review-counterparty").textContent();
  await page
    .getByRole("group", { name: /woanders hin|Wohin gehört/ })
    .getByRole("button", { name: "Mobilität" })
    .click();
  await expect(page.getByRole("dialog", { name: "Gespeichert" })).toContainText(
    `„${first}“ ist ab jetzt immer Mobilität`,
  );
  await expect(page.getByRole("dialog", { name: "Nur Demo" })).toHaveCount(0);
  // Saved for real: after a reload the next booking is up, not the same one.
  await page.goto(`${DEMO_URL}/pruefen`);
  await expect(page.getByTestId("review-counterparty")).not.toHaveText(first ?? "");
});

test("Demo: in der Liste bestätigen geht ohne Hinweis-Pop-up", async ({ page }) => {
  await importDemo(page);
  await page.goto(`${DEMO_URL}/buchungen?pruefen=1`);
  const row = page.getByRole("list", { name: "Buchungen" }).getByRole("listitem").first();
  await row.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("dialog", { name: "Nur Demo" })).toHaveCount(0);
});

test("unter 60 % Sicherheit gibt es keinen vorgewählten Vorschlag, nur einen Hinweis", async ({ page }) => {
  await importDemo(page);
  // The model guessed Haushalt for dm with only 40 %.
  await sql(`
    update transactions set category_id = (select id from categories where name = 'Haushalt'),
      category_source = 'ai', ai_confidence = 0.4, needs_review = true
    where counterparty = 'dm-drogerie markt';`);
  await page.goto("/pruefen");
  await expect(page.getByTestId("review-counterparty")).toHaveText("dm-drogerie markt");
  await expect(page.getByRole("button", { name: /^Passt:/ })).toHaveCount(0);
  await expect(page.getByText("Die KI ist unsicher (40 %, vielleicht Haushalt). Bitte selbst wählen.")).toBeVisible();
});
