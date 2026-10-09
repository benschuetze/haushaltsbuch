import { expect, type Page, test } from "@playwright/test";
import { importDemo, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

const bell = (page: Page) => page.getByTestId("notifications");

test("Glocke zeigt einen Punkt, durch die unsicheren Buchungen klicken, Pop-up bestätigt die dauerhafte Wahl", async ({
  page,
}) => {
  await importDemo(page);
  // The mock model is unsure about Zalando (PayPal) and dm: 3 bookings wait for review.
  await page.goto("/");
  await expect(bell(page).getByTestId("notification-dot")).toBeVisible();
  await bell(page).locator("summary").click();
  await bell(page).getByRole("link", { name: "3 Buchungen prüfen" }).click();

  await expect(page.getByTestId("review-remaining")).toHaveText("noch 3");
  await expect(page.getByTestId("review-counterparty")).toHaveText("dm-drogerie markt");
  await page.getByRole("button", { name: "Gesundheit" }).click();

  const dialog = page.getByRole("dialog", { name: "Gespeichert" });
  await expect(dialog).toContainText("„dm-drogerie markt“ ist ab jetzt immer Gesundheit");
  await expect(dialog).toContainText("1 weitere Buchung wurde gleich mit zugeordnet");
  await dialog.getByRole("button", { name: "Weiter" }).click();
  await expect(dialog).toBeHidden();

  // The second dm booking was taken care of by the new rule; only the PayPal one is left.
  await expect(page.getByTestId("review-remaining")).toHaveText("noch 1");
  await expect(page.getByTestId("review-counterparty")).toHaveText("PayPal Europe");
  await page.getByRole("button", { name: "Kleidung" }).click();
  await expect(page.getByRole("dialog", { name: "Gespeichert" })).toContainText("keine feste Regel");
  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByRole("heading", { name: "Alles geprüft" })).toBeVisible();

  await page.goto("/regeln");
  await expect(page.getByTestId("rule")).toHaveCount(1);
});

test("Budget anpassen, Überschreitung erscheint als Hinweis in der Glocke, Erledigt blendet ihn aus", async ({
  page,
}) => {
  await importDemo(page);
  await page.goto("/budgets");
  const food = page.getByTestId("budget").filter({ hasText: "Lebensmittel" });
  await expect(food.getByTestId("budget-usage")).toHaveText("226,29 € von 450,00 €");
  await food.getByLabel("Budget pro Monat (€)").fill("200");
  await food.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByRole("status")).toHaveText("Budget auf 200,00 € gesetzt.");
  await expect(food.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

  await bell(page).locator("summary").click();
  await bell(page).getByRole("link", { name: "Budget Lebensmittel überschritten" }).click();
  const hint = page.getByTestId("insight").filter({ hasText: "Budget Lebensmittel überschritten" });
  await expect(hint).toContainText("226,29 € von 200 € ausgegeben (113 %), 26,29 € drüber.");
  await hint.getByRole("button", { name: "Erledigt" }).click();
  await expect(page.getByTestId("insight").filter({ hasText: "Budget Lebensmittel überschritten" })).toHaveCount(0);
});

test("eigene Kategorie mit Budget anlegen", async ({ page }) => {
  await page.goto("/budgets");
  await page.getByLabel("Name").fill("Urlaub");
  await page.getByLabel("Budget pro Monat (€, optional)").fill("250");
  await page.getByRole("button", { name: "Kategorie anlegen" }).click();
  await expect(page.getByRole("status")).toHaveText("Kategorie „Urlaub“ angelegt mit 250,00 € Budget.");
  await expect(page.getByTestId("budget").filter({ hasText: "Urlaub" })).toBeVisible();
});

test("Abos werden aus regelmäßigen Zahlungen erkannt, auch ohne Abo-Kategorie", async ({ page }) => {
  await importDemo(page);
  // A gym booked as leisure, monthly: a typical forgotten subscription.
  await sql(`
    insert into transactions (account_id, import_id, booking_date, amount_cents, counterparty, purpose, raw, dedupe_hash, category_id, category_source)
    select t.account_id, t.import_id, d::date, -2990, 'Fitnessstudio Kraftwerk', 'Mitgliedsbeitrag', '{}'::jsonb, 'gym-' || d, c.id, 'rule'
    from (select account_id, import_id from transactions limit 1) t, categories c,
         unnest(array['2026-07-03','2026-08-03','2026-09-03']) as d
    where c.name = 'Freizeit'`);
  await page.goto("/abos");
  const gym = page.getByTestId("recurring").filter({ hasText: "Fitnessstudio Kraftwerk" });
  await expect(gym).toContainText("monatlich · Freizeit");
  await expect(gym).toContainText("358,80 € im Jahr");
});

test("das Glocken-Menü liegt vollständig im Bildschirm, auch auf dem Handy", async ({ page }) => {
  await importDemo(page);
  await page.goto("/");
  await bell(page).locator("summary").click();
  const panel = bell(page).locator("summary + div");
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  expect(box, "Menü hat keine Fläche").not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
});
