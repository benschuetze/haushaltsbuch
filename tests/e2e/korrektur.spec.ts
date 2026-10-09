import { expect, test } from "@playwright/test";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("Kategorie ändern, Regel anlegen: alle Buchungen des Empfängers sind umkategorisiert, manuelle bleiben", async ({
  page,
}) => {
  await importDemo(page);

  // August-Buchung von Telekom bewusst manuell anders setzen. Die neue Regel darf sie nicht anfassen.
  await page.goto("/transaktionen?monat=2026-08");
  await page.getByLabel("Kategorie für Telekom Deutschland am 10.08.2026").selectOption({ label: "Haushalt" });
  await page
    .getByLabel("Kategorie für Telekom Deutschland am 10.08.2026")
    .locator("..")
    .getByRole("button", { name: "Ändern" })
    .click();
  await expect(page.getByRole("status")).toContainText("Regel für „Telekom Deutschland“ anlegen?");
  await page.getByRole("link", { name: "Nein, danke" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);

  await page.goto("/transaktionen?monat=2026-09");
  const september = page.getByLabel("Kategorie für Telekom Deutschland am 10.09.2026");
  await september.selectOption({ label: "Versicherungen" });
  await september.locator("..").getByRole("button", { name: "Ändern" }).click();
  await page.getByRole("button", { name: "Regel anlegen" }).click();
  await expect(page.getByRole("status")).toContainText("Regel angelegt: „Telekom Deutschland“ → Versicherungen");

  await page.goto("/transaktionen");
  await expect(page.getByLabel("Kategorie für Telekom Deutschland am 10.09.2026")).toHaveValue(
    await optionValue(page, "Versicherungen"),
  );
  await expect(page.getByLabel("Kategorie für Telekom Deutschland am 10.08.2026")).toHaveValue(
    await optionValue(page, "Haushalt"),
  );

  await page.goto("/regeln");
  await expect(page.getByTestId("rule")).toHaveCount(1);
  await expect(page.getByTestId("rule").getByLabel("Muster")).toHaveValue("Telekom Deutschland");
});

test("Regel mit ungültigem Regex wird mit Hinweis abgelehnt", async ({ page }) => {
  await page.goto("/regeln");
  const form = page.getByRole("region", { name: "Neue Regel" });
  await form.getByLabel("Vergleich").selectOption("regex");
  await form.getByLabel("Muster").fill("(");
  await form.getByLabel("Kategorie").selectOption({ label: "Sonstiges" });
  await form.getByRole("button", { name: "Regel anlegen" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ungültiger regulärer Ausdruck");
});

async function optionValue(page: import("@playwright/test").Page, label: string): Promise<string> {
  return page
    .locator("select[name=categoryId] option", { hasText: label })
    .first()
    .getAttribute("value") as Promise<string>;
}
