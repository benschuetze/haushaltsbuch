import { expect, test } from "./fixtures";
import { importDemo, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

test("lange Buchungsliste: erst die neuesten 100, auf Wunsch mehr, Filter zählen über alle", async ({ page }) => {
  await importDemo(page);
  // A longer history than the demo file: 150 made-up card payments in July.
  await sql(`
    insert into transactions (account_id, import_id, booking_date, amount_cents, counterparty, purpose, raw, dedupe_hash)
    select t.account_id, t.import_id, date '2026-07-01' + (n % 28), -100 - n, 'Testladen ' || n, 'Kartenzahlung', '{}'::jsonb, 'paging-' || n
    from (select account_id, import_id from transactions limit 1) t, generate_series(1, 150) n;`);
  await page.goto("/transaktionen");
  const list = page.getByRole("list", { name: "Buchungen" }).getByRole("listitem");
  await expect(list).toHaveCount(100);
  const summary = page.getByTestId("transactions-count");
  await expect(summary).toHaveText(/^Die neuesten 100 von \d+ Buchungen$/);
  const total = Number((await summary.textContent())?.match(/von (\d+)/)?.[1]);
  expect(total).toBeGreaterThan(100);

  await page.getByRole("link", { name: /^Weitere \d+ anzeigen$/ }).click();
  await expect(list).toHaveCount(Math.min(200, total));

  // A month filter counts within that month and needs no paging.
  await page.goto("/transaktionen?monat=2026-09");
  await expect(summary).toHaveText(/^\d+ Buchungen$/);
  await expect(page.getByRole("link", { name: /^Weitere/ })).toHaveCount(0);
});

test("Handy: eine Buchung ist eine kompakte Zeile, die Kategorie öffnet sich erst beim Antippen", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "betrifft nur Handys");
  await importDemo(page);
  await page.goto("/transaktionen?monat=2026-09");
  const row = page.getByTestId("transaction").first();
  const box = await row.boundingBox();
  expect(box?.height).toBeLessThanOrEqual(140);
  await expect(row.getByRole("combobox")).toBeHidden();
  await row.getByTestId("category-chip").click();
  await expect(row.getByRole("combobox")).toBeVisible();
});
