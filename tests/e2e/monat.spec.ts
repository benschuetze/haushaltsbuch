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

test("Umbuchungen: Anzahl und bewegter Betrag statt eines Saldos von 0,00 €", async ({ page }) => {
  await importDemo(page);
  await page.goto("/monat/2026-09");
  // erwartet.json: one transfer to savings, 300,00 €.
  await expect(page.getByTestId("transfers")).toHaveText(
    `1 Umbuchung zwischen eigenen Konten · ${formatCents(-(expected.months["2026-09"]?.transfer_cents ?? 0))} bewegt`,
  );
});

test("Vergleich mit dem Vormonat in Worten statt mit Vorzeichen", async ({ page }) => {
  await importDemo(page);
  await page.goto("/monat/2026-09");
  // From erwartet.json: spent 1.608,30 (August 1.715,45), earned 4.121,40 (August 3.871,40).
  await expect(page.getByTestId("expenses")).toContainText("107,15 € weniger ausgegeben als im August");
  await expect(page.getByTestId("income")).toContainText("250,00 € mehr eingenommen als im August");
});

test("kein Link in einen Monat, der noch nicht begonnen hat", async ({ page }) => {
  const now = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 7);
  await page.goto(`/monat/${now}`);
  await expect(page.getByRole("navigation", { name: "Monat wechseln" }).getByRole("link")).toHaveCount(1);
});
