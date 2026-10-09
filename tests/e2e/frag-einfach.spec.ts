import { expect, test } from "@playwright/test";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("Startseite: die Zahl für heute steht ohne Frage da, „Wie gerechnet?“ erklärt sie", async ({ page }) => {
  await importDemo(page);
  await page.goto("/");
  await expect(page.getByTestId("today-amount")).toHaveText(/^\d{1,3}(\.\d{3})*,\d{2} €$/);
  await expect(page.getByTestId("today-context")).toBeVisible();
  await page.getByText("Wie gerechnet?").click();
  await expect(page.getByText("Ausgegeben:")).toBeVisible();
});

test("Vorschlag antippen: Antwort erscheint direkt darunter, mit Urteil", async ({ page }) => {
  await importDemo(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Kann ich mir 80 € fürs Feiern leisten?" }).click();
  await expect(page.getByTestId("ask-answer")).toHaveText(/^(Ja, locker|Ja, geht|Knapp|Eher nicht)\./);
});

test("eigene Frage tippen, Nachfrage behält den Zusammenhang", async ({ page }) => {
  await importDemo(page);
  await page.goto("/");
  const box = page.getByLabel("Frage an dein Haushaltsbuch");
  await box.fill("Wie viel kann ich heute ausgeben?");
  await box.press("Enter");
  await expect(page.getByTestId("ask-answer").first()).toContainText("drin");
  await box.fill("Kann ich mir 25 € für Pizza leisten?");
  await page.getByRole("button", { name: "Fragen" }).click();
  await expect(page.getByTestId("ask-answer")).toHaveCount(2);
  await expect(page.getByTestId("ask-answer").nth(1)).toHaveText(/^(Ja, locker|Ja, geht|Knapp|Eher nicht)\./);
});
