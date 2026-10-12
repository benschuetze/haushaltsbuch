import { expect, test } from "./fixtures";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("Startseite: die Zahl für heute steht ohne Frage da, „Wie gerechnet?“ erklärt sie", async ({ page }) => {
  await importDemo(page);
  await page.goto("/");
  await expect(page.getByTestId("today-amount")).toHaveText(/^\d{1,3}(\.\d{3})*,\d{2} €$/);
  await expect(page.getByTestId("today-context")).toBeVisible();
  await page.getByText("Wie gerechnet?").click();
  await expect(page.getByText("Ausgegeben", { exact: true })).toBeVisible();
  // What the number leaves out is said, not only written in a code comment.
  await expect(page.getByTestId("today-limits")).toContainText("Restgeld vom Vormonat zählt nicht mit");
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
  await expect(page.getByTestId("ask-answer").first()).toContainText("Tagesbudget");
  await box.fill("Kann ich mir 25 € für Pizza leisten?");
  await page.getByRole("button", { name: "Fragen" }).click();
  await expect(page.getByTestId("ask-answer")).toHaveCount(2);
  await expect(page.getByTestId("ask-answer").nth(1)).toHaveText(/^(Ja, locker|Ja, geht|Knapp|Eher nicht)\./);
});

test("„Diese Woche“: Betrag seit Montag, mit Vergleich oder ehrlichem Hinweis", async ({ page }) => {
  await importDemo(page);
  await page.goto("/");
  await expect(page.getByTestId("week-spent")).toHaveText(/€$/);
  await expect(page.getByTestId("week-compare")).toHaveText(
    /(weniger|mehr) als sonst bis \w+|fehlen noch ein paar Wochen|Bisher nichts ausgegeben|noch nichts ausgegeben|Genau wie sonst/,
  );
});

test("eine ruhige Stimme: keine Ton-Auswahl, auch ein früher gespeichertes „frech“ wirkt nicht mehr", async ({
  page,
}) => {
  await importDemo(page);
  await page.addInitScript(() => localStorage.setItem("ton", "frech"));
  await page.goto("/");
  await expect(page.getByRole("group", { name: "Ton der Antworten" })).toHaveCount(0);
  await page.getByRole("button", { name: "Kann ich mir 80 € fürs Feiern leisten?" }).click();
  await expect(page.getByTestId("ask-answer")).toBeVisible();
  await expect(page.getByTestId("ask-answer")).not.toHaveText(/^(Gönn dir\.|Autsch\.|Hm, mutig\.) /);
});

test("doppelt abgeschickt (Tastatur + Spracheingabe auf iOS) ergibt eine Frage und eine Antwort, keinen hängenden Kringel", async ({
  page,
}) => {
  await importDemo(page);
  await page.goto("/");
  const box = page.getByLabel("Frage an dein Haushaltsbuch");
  await box.fill("Wie viel kann ich heute ausgeben?");
  // Two submits in the same moment, before React has re-rendered.
  await box.evaluate((input) => {
    const form = (input as HTMLInputElement).form as HTMLFormElement;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(page.getByTestId("ask-answer")).toHaveCount(1);
  await expect(page.getByTestId("ask-answer")).toContainText("Tagesbudget");
  await expect(page.getByLabel("Antwort kommt")).toHaveCount(0);
});

test("Assistent: doppelt abgeschickt ergibt eine Frage", async ({ page }) => {
  await importDemo(page);
  await page.goto("/buchungen");
  await page.getByRole("button", { name: "Assistent öffnen" }).last().click();
  const panel = page.getByRole("dialog", { name: "Assistent" });
  await panel.getByLabel("Frage an den Assistenten").fill("Wie stehen meine Budgets?");
  await panel.getByLabel("Frage an den Assistenten").evaluate((el) => {
    const form = (el as HTMLTextAreaElement).form as HTMLFormElement;
    form.requestSubmit();
    form.requestSubmit();
  });
  await expect(panel.locator('[data-role="assistant"]')).toHaveCount(1);
  await expect(panel.locator('[data-role="user"]')).toHaveCount(1);
});

test("Startseite: ein Weg zum Fragen, kein zweiter Chat daneben", async ({ page }, testInfo) => {
  await importDemo(page);
  await page.goto("/");
  await expect(page.getByLabel("Frage an dein Haushaltsbuch")).toBeVisible();
  await expect(page.getByRole("button", { name: "Assistent öffnen" })).toHaveCount(0);
  if (testInfo.project.name === "mobile") {
    // On the phone the tab bar's "Fragen" leads into the box on the page instead of a chat on top of it.
    await page.getByRole("button", { name: "Zum Fragefeld" }).click();
    await expect(page.getByLabel("Frage an dein Haushaltsbuch")).toBeFocused();
    await expect(page.getByRole("dialog", { name: "Assistent" })).toHaveCount(0);
  }
  // Elsewhere the chat stays one tap away.
  await page.goto("/buchungen");
  await expect(page.getByRole("button", { name: "Assistent öffnen" }).last()).toBeVisible();
});
