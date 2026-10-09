import { expect, test } from "@playwright/test";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("Monatsrückblick: Karten mit den Zahlen des Monats, blättern per Knopf und Pfeiltaste", async ({ page }) => {
  await importDemo(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Monatsrückblick ansehen" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Dein \w+ 2026$/);

  await page.goto("/rueckblick?monat=2026-09");
  const cards = page.getByTestId("story-card");
  await expect(cards.first()).toContainText("September 2026");
  await expect(cards.first()).toContainText("ausgegeben");
  await expect(page.getByRole("article", { name: "Größte einzelne Ausgabe" })).toContainText(
    "Hausverwaltung Sonnenhof",
  );
  await expect(page.getByRole("article", { name: "Im Vergleich zum Vormonat" })).toBeAttached();

  await page.getByRole("button", { name: "Weiter" }).click();
  await expect(page.getByRole("button", { name: "Zurück" })).toBeEnabled();
  await page.getByTestId("story").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("link", { name: "Rückblick August 2026" })).toBeVisible();
});

test("Monat ohne Buchungen: verständliche 404", async ({ page }) => {
  await importDemo(page);
  const res = await page.goto("/rueckblick?monat=2020-01");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Für diesen Monat gibt es keine Buchungen.")).toBeVisible();
});
