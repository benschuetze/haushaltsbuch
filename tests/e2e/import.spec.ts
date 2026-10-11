import { expect, test } from "./fixtures";
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
  await page.getByLabel("Kontoauszüge").setInputFiles({
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
  await page.getByLabel("Kontoauszüge").setInputFiles({
    name: "andere-bank.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Datum,Betrag\n01.10.2026,5.00"),
  });
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByRole("alert")).toContainText("sieht nicht nach einer Umsatz-Tabelle aus");
});

test("CAMT.053 und MT940 werden erkannt und importiert, Vorgemerktes übersprungen", async ({ page }) => {
  await page.goto("/import");
  await page
    .getByLabel("Kontoauszüge")
    .setInputFiles([
      "app/lib/import/profiles/__fixtures__/camt053.xml",
      "app/lib/import/profiles/__fixtures__/mt940.sta",
    ]);
  await page.getByRole("button", { name: "Importieren" }).click();
  const camt = page.getByRole("status", { name: "Ergebnis für camt053.xml" });
  await expect(camt.getByTestId("import-account")).toContainText("CAMT.053 ··2051");
  await expect(camt.getByTestId("import-inserted")).toHaveText("3");
  await expect(camt.getByTestId("import-skipped")).toHaveText("1");
  const mt940 = page.getByRole("status", { name: "Ergebnis für mt940.sta" });
  await expect(mt940.getByTestId("import-account")).toContainText("MT940 ··5100");
  await expect(mt940.getByTestId("import-inserted")).toHaveText("4");
});
