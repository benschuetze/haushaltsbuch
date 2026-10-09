import { expect, type Page, test } from "@playwright/test";
import { resetDb } from "./helpers";

/** The section starts open while there is only one account; clicking the summary then would close it. */
async function openNewAccount(page: Page) {
  const details = page.locator("details").filter({ hasText: "Neues Konto anlegen" });
  if (!(await details.evaluate((el) => (el as HTMLDetailsElement).open))) await details.locator("summary").click();
  return details;
}

test.beforeEach(resetDb);

test("Konto für die Sparkasse anlegen, Export importieren: gebuchte neu, vorgemerkte getrennt ausgewiesen", async ({
  page,
}) => {
  await page.goto("/import");
  const newAccount = await openNewAccount(page);
  await newAccount.getByLabel("Name").fill("Sparkasse Giro");
  await newAccount.getByLabel("Bank").selectOption({ label: "Sparkasse (CSV-CAMT V2)" });
  await newAccount.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByRole("status")).toContainText("Konto „Sparkasse Giro“ angelegt");
  await expect(page.getByLabel("Konto")).toHaveValue(/.+/);
  await expect(page.getByLabel("Konto").locator("option:checked")).toHaveText(
    "Sparkasse Giro (Sparkasse (CSV-CAMT V2))",
  );

  await page.getByLabel("CSV-Datei").setInputFiles("beispieldaten/banken/sparkasse.csv");
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByTestId("import-total")).toHaveText("20");
  await expect(page.getByTestId("import-inserted")).toHaveText("19");
  await expect(page.getByTestId("import-skipped")).toHaveText("1");
  await expect(page.getByTestId("import-rejected")).toHaveText("0");

  // Same account, but an ING file: the error names the bank instead of a cryptic header message.
  await page.getByLabel("CSV-Datei").setInputFiles("beispieldaten/banken/ing.csv");
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByRole("alert")).toContainText("sieht nach ING aus");
});

test("ein Kontoname kann nicht doppelt vergeben werden", async ({ page }) => {
  await page.goto("/import");
  const newAccount = await openNewAccount(page);
  await newAccount.getByLabel("Name").fill("Girokonto (Demo)");
  await newAccount.getByLabel("Bank").selectOption({ label: "ING" });
  await newAccount.getByRole("button", { name: "Konto anlegen" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ein Konto „Girokonto (Demo)“ gibt es schon.");
});
