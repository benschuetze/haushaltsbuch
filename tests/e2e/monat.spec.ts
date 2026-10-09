import { readFileSync } from "node:fs";
import { formatCents } from "../../app/lib/money";
import { expect, test } from "./fixtures";
import { importDemo, resetDb } from "./helpers";

const expected: { months: Record<string, { income_cents: number; expense_cents: number; transfer_cents: number }> } =
  JSON.parse(readFileSync("beispieldaten/erwartet.json", "utf8"));

test.beforeAll(resetDb);

test("Summen für 2026-08 und 2026-09 stimmen mit erwartet.json überein", async ({ page }) => {
  await importDemo(page);
  for (const [month, m] of Object.entries(expected.months)) {
    await page.goto(`/monat/${month}`);
    await expect(page.getByTestId("income")).toContainText(formatCents(m.income_cents));
    await expect(page.getByTestId("expenses")).toContainText(formatCents(m.expense_cents - m.transfer_cents));
    await expect(page.getByTestId("balance")).toContainText(
      formatCents(m.income_cents + m.expense_cents - m.transfer_cents),
    );
  }
});

test("leerer Monat zeigt einen Hinweis statt eines Fehlers", async ({ page }) => {
  await page.goto("/monat/2020-01");
  await expect(page.getByRole("status")).toHaveText("Für Januar 2020 gibt es keine Buchungen.");
});

test("ungültiger Monat ergibt eine verständliche 404", async ({ page }) => {
  const response = await page.goto("/monat/2026-13");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Monat im Format JJJJ-MM")).toBeVisible();
});
