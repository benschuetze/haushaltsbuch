import { readFileSync } from "node:fs";
import { expect, test } from "./fixtures";
import { resetDb } from "./helpers";

test.beforeEach(resetDb);

test("automatisch angelegtes Konto umbenennen, Name muss eindeutig sein", async ({ page }) => {
  await page.goto("/import");
  await page
    .getByLabel("Kontoauszüge")
    .setInputFiles("beispieldaten/banken/neu/Kontoumsaetze_100_1234567_00_20261008.csv");
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByTestId("import-account")).toContainText("Konto „Neue Bank ··0003“ neu angelegt");

  // Accounts now live on the bank page; the old address still leads there.
  await page.goto("/konten");
  await expect(page).toHaveURL(/\/banken#konten$/);
  const account = page.getByTestId("account").filter({ hasText: "6 Buchungen" });
  await account.getByLabel("Name").fill("Deutsche Bank Giro");
  await account.getByRole("button", { name: "Umbenennen" }).click();
  await expect(account.getByRole("status")).toHaveText("Umbenannt in „Deutsche Bank Giro“.");

  const demo = page.getByTestId("account").filter({ hasText: "Standard (Demo-Format)" });
  await demo.getByLabel("Name").fill("Deutsche Bank Giro");
  await demo.getByRole("button", { name: "Umbenennen" }).click();
  await expect(demo.getByRole("alert")).toHaveText("Ein Konto „Deutsche Bank Giro“ gibt es schon.");

  // The new name is what the import page offers from now on.
  await page.goto("/import");
  await expect(page.getByLabel("Konto", { exact: true })).toContainText("Deutsche Bank Giro");
});

test("Kontostand aus dem Export, wo die Bank ihn mitliefert, sonst ehrlich „nicht enthalten“", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Kontoauszüge").setInputFiles("beispieldaten/banken/volksbank.csv");
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByTestId("import-account")).toBeVisible();

  // Straight from the file: the balance column of the latest booking.
  const rows = readFileSync("beispieldaten/banken/volksbank.csv", "utf8")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((l) => l.split(";"));
  const header = readFileSync("beispieldaten/banken/volksbank.csv", "utf8").split(/\r?\n/)[0]?.split(";") ?? [];
  const dateCol = header.findIndex((h) => /Buchungstag/.test(h));
  const saldoCol = header.findIndex((h) => /Saldo/.test(h));
  const iso = (d: string) => d.split(".").reverse().join("-");
  const latest = rows.sort((a, b) => iso(b[dateCol] ?? "").localeCompare(iso(a[dateCol] ?? "")))[0] ?? [];

  await page.goto("/banken");
  const volksbank = page.getByTestId("account").filter({ hasText: "Volksbank" });
  await expect(volksbank.getByTestId("account-balance")).toHaveText(
    `Kontostand am ${latest[dateCol]}: ${latest[saldoCol]} €`,
  );
  const demo = page.getByTestId("account").filter({ hasText: "Standard (Demo-Format)" });
  await expect(demo.getByTestId("account-balance")).toHaveText("Kontostand: im Export nicht enthalten");
});
