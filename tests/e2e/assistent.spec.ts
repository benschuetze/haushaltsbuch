import { expect, type Page, test } from "@playwright/test";
import { DEMO_URL, importDemo, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

const panel = (page: Page) => page.getByRole("dialog", { name: "Assistent" });

async function addGym() {
  await sql(`
    insert into transactions (account_id, import_id, booking_date, amount_cents, counterparty, purpose, raw, dedupe_hash, category_id, category_source)
    select t.account_id, t.import_id, d::date, -2990, 'Fitnessstudio Kraftwerk', 'Mitgliedsbeitrag', '{}'::jsonb, 'gym-' || d, c.id, 'rule'
    from (select account_id, import_id from transactions limit 1) t, categories c,
         unnest(array['2026-07-03','2026-08-03','2026-09-03']) as d
    where c.name = 'Freizeit'`);
}

test("Kreis unten rechts öffnet den Chat, Vorschlag findet versteckte Abos", async ({ page }) => {
  await importDemo(page);
  await addGym();
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
  await page.getByRole("button", { name: "Assistent öffnen" }).click();
  const box = await panel(page).boundingBox();
  const vp = page.viewportSize();
  expect(box && vp && box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0).toBe(true);
});

test.describe("Demo", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: DEMO_URL });
  test("Assistent antwortet auch in der Demo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Assistent öffnen" }).click();
    await panel(page).getByRole("button", { name: "Wie stehen meine Budgets?" }).click();
    await expect(panel(page).locator('[data-role="assistant"]')).toContainText(/Budgets|Knapp/);
  });
});
