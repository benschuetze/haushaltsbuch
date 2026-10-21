import { expect, type Page, test } from "./fixtures";
import { DEMO_URL, importDemo, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

const panel = (page: Page) => page.getByRole("dialog", { name: "Assistent" });

// Relative to today: the server judges "still running" against the real clock, fixed dates rot.
async function addGym() {
  await sql(`
    insert into transactions (account_id, import_id, booking_date, amount_cents, counterparty, purpose, raw, dedupe_hash, category_id, category_source)
    select t.account_id, t.import_id, m.d, -2990, 'Fitnessstudio Kraftwerk', 'Mitgliedsbeitrag', '{}'::jsonb, 'gym-' || m.d, c.id, 'rule'
    from (select account_id, import_id from transactions limit 1) t, categories c,
         generate_series(0, 2) as n, lateral (select (current_date - 2 - n * 30) as d) as m
    where c.name = 'Freizeit'`);
}

test("Kreis unten rechts öffnet den Chat, Vorschlag findet versteckte Abos", async ({ page }) => {
  await importDemo(page);
  await addGym();
  await page.goto("/buchungen");
  await page.getByRole("button", { name: "Assistent öffnen" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByLabel("Frage an den Assistenten")).toBeFocused();

  await panel(page).getByRole("button", { name: "Habe ich versteckte Abo-Kosten?" }).click();
  const answer = panel(page).locator('[data-role="assistant"]');
  await expect(answer).toContainText("Fitnessstudio Kraftwerk");
  await expect(answer).toContainText("Nicht als Abo einsortiert");
});

test("eigene Frage per Enter, Verlauf bleibt, Escape schließt", async ({ page }) => {
  await importDemo(page);
  await page.goto("/buchungen");
  await page.getByRole("button", { name: "Assistent öffnen" }).click();
  await page.getByLabel("Frage an den Assistenten").fill("Wie waren meine Ausgaben?");
  await page.getByLabel("Frage an den Assistenten").press("Enter");
  await expect(panel(page).locator('[data-role="assistant"]')).toContainText("Einnahmen 4.121,40 €");
  await expect(panel(page).locator('[data-role="user"]')).toHaveText("Wie waren meine Ausgaben?");

  await page.getByLabel("Frage an den Assistenten").fill("Und meine Budgets?");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(panel(page).locator('[data-role="assistant"]')).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("das Chatfenster passt auf den Bildschirm", async ({ page }) => {
  await page.goto("/buchungen");
  await page.getByRole("button", { name: "Assistent öffnen" }).click();
  const box = await panel(page).boundingBox();
  const vp = page.viewportSize();
  expect(box && vp && box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0).toBe(true);
});

test.describe("Demo", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: DEMO_URL });
  test("Assistent antwortet auch in der Demo", async ({ page }) => {
    await page.goto("/buchungen");
    await page.getByRole("button", { name: "Assistent öffnen" }).click();
    await panel(page).getByRole("button", { name: "Wie stehen meine Budgets?" }).click();
    await expect(panel(page).locator('[data-role="assistant"]')).toContainText(/Budgets|Knapp/);
  });
});
