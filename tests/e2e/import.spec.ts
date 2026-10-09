import { expect, test } from "@playwright/test";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("Demo-CSV hochladen zeigt 44 neu, erneut hochladen zeigt 44 Duplikate", async ({ page }) => {
  await importDemo(page);
  await expect(page.getByTestId("import-total")).toHaveText("44");
  await expect(page.getByTestId("import-inserted")).toHaveText("44");
  await expect(page.getByTestId("import-duplicates")).toHaveText("0");
  await expect(page.getByTestId("import-rejected")).toHaveText("0");

  await importDemo(page);
  await expect(page.getByTestId("import-inserted")).toHaveText("0");
  await expect(page.getByTestId("import-duplicates")).toHaveText("44");
});

test("kaputte Zeilen werden mit Zeilennummer und Grund gezeigt, der Rest wird importiert", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("CSV-Datei").setInputFiles({
    name: "kaputt.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      [
        "Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung",
        "01.10.2026;01.10.2026;REWE Markt;Einkauf;-12,00;EUR",
        "02.10.2026;02.10.2026;REWE Markt;Einkauf;abc;EUR",
      ].join("\n"),
    ),
  });
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByTestId("import-inserted")).toHaveText("1");
  await expect(page.getByTestId("import-rejected")).toHaveText("1");
  await expect(page.getByText('Zeile 3: Ungültiger Betrag: "abc"')).toBeVisible();
});

test("falsches Dateiformat wird verständlich abgelehnt", async ({ page }) => {
  await page.goto("/import");
  await page.getByLabel("CSV-Datei").setInputFiles({
    name: "andere-bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Datum,Betrag\n01.10.2026,5.00"),
  });
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByRole("alert")).toContainText("Kopfzeile passt nicht");
});
