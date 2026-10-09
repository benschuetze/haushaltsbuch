import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { resetDb } from "./helpers";

test.beforeEach(resetDb);

function result(page: Page, filename: string) {
  return page.getByRole("status", { name: `Ergebnis für ${filename}` });
}

test("mehrere Auszüge auf einmal: Bank, Format und Konto erkennt die App selbst", async ({ page }) => {
  await page.goto("/import");
  await expect(page.getByLabel("Konto")).toHaveValue("");
  await page
    .getByLabel("CSV-Dateien")
    .setInputFiles([
      "beispieldaten/banken/sparkasse.csv",
      "beispieldaten/banken/ing.csv",
      "beispieldaten/banken/neu/n26-csv-transactions.csv",
      "beispieldaten/banken/neu/kontoflow-export.csv",
    ]);
  await page.getByRole("button", { name: "Importieren" }).click();

  const sparkasse = result(page, "sparkasse.csv");
  await expect(sparkasse.getByTestId("import-account")).toHaveText(
    "Konto „Sparkasse (CSV-CAMT V2) ··3456“ neu angelegt · Sparkasse (CSV-CAMT V2)",
  );
  await expect(sparkasse.getByTestId("import-inserted")).toHaveText("19");
  await expect(sparkasse.getByTestId("import-skipped")).toHaveText("1");

  await expect(result(page, "ing.csv").getByTestId("import-account")).toContainText("ING ··0000“ neu angelegt");

  const n26 = result(page, "n26-csv-transactions.csv");
  await expect(n26.getByTestId("import-account")).toHaveText(
    "Konto „N26“ neu angelegt · N26 · neues Format an den Spaltennamen erkannt",
  );
  await expect(n26.getByTestId("import-inserted")).toHaveText("6");

  const kontoflow = result(page, "kontoflow-export.csv");
  await expect(kontoflow.getByTestId("import-account")).toContainText("neues Format per KI zugeordnet");
  await expect(kontoflow.getByTestId("import-inserted")).toHaveText("3");

  // Second round: everything is known now, nothing is learned or created again.
  await page.getByLabel("CSV-Dateien").setInputFiles(["beispieldaten/banken/neu/n26-csv-transactions.csv"]);
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(result(page, "n26-csv-transactions.csv").getByTestId("import-account")).toHaveText("Konto „N26“ · N26");
  await expect(result(page, "n26-csv-transactions.csv").getByTestId("import-duplicates")).toHaveText("6");
});

test("eine unlesbare Datei stoppt die anderen nicht", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("CSV-Dateien").setInputFiles([
    { name: "kaputt.csv", mimeType: "text/csv", buffer: Buffer.from("nur;zwei\n1;2") },
    // Playwright cannot mix paths and buffers in one call, so the DKB file goes in as a buffer too.
    { name: "dkb.csv", mimeType: "text/csv", buffer: readFileSync("beispieldaten/banken/dkb.csv") },
  ]);
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByRole("region", { name: "Fehler bei kaputt.csv" }).getByRole("alert")).toContainText(
    "keine Kopfzeile",
  );
  await expect(result(page, "dkb.csv").getByTestId("import-inserted")).toHaveText("9");
});

test("Konto von Hand gewählt, aber falsche Bank: Hinweis statt Import", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("Konto").selectOption({ label: "Girokonto (Demo) (Standard (Demo-Format))" });
  await page.getByLabel("CSV-Dateien").setInputFiles("beispieldaten/banken/ing.csv");
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByRole("alert")).toContainText("sieht nach ING aus");
});
