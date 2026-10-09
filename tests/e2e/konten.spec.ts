import { expect, test } from "./fixtures";
import { resetDb } from "./helpers";

test.beforeEach(resetDb);

test("automatisch angelegtes Konto umbenennen, Name muss eindeutig sein", async ({ page }) => {
  await page.goto("/import");
  await page
    .getByLabel("CSV-Dateien")
    .setInputFiles("beispieldaten/banken/neu/Kontoumsaetze_100_1234567_00_20261008.csv");
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByTestId("import-account")).toContainText("Konto „Neue Bank ··0003“ neu angelegt");

  await page.getByRole("link", { name: "Konten" }).click();
  const account = page.getByTestId("account").filter({ hasText: "6 Buchungen" });
  await account.getByLabel("Name").fill("Deutsche Bank Giro");
  await account.getByRole("button", { name: "Umbenennen" }).click();
  await expect(page.getByRole("status")).toHaveText("Umbenannt in „Deutsche Bank Giro“.");

  const demo = page.getByTestId("account").filter({ hasText: "Standard (Demo-Format)" });
  await demo.getByLabel("Name").fill("Deutsche Bank Giro");
  await demo.getByRole("button", { name: "Umbenennen" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ein Konto „Deutsche Bank Giro“ gibt es schon.");

  // The new name is what the import page offers from now on.
  await page.goto("/import");
  await expect(page.getByLabel("Konto")).toContainText("Deutsche Bank Giro");
});
