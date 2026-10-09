import { expect, test } from "@playwright/test";
import {
  collectConsoleErrors,
  expectNoHorizontalOverflow,
  expectNoSeriousA11yViolations,
  expectOnTop,
  importDemo,
  resetDb,
} from "./helpers";

const PAGES = [
  { path: "/", heading: "Übersicht", action: { role: "link" as const, name: "Ganzer Monat" } },
  { path: "/transaktionen", heading: "Buchungen", action: { role: "button" as const, name: "Filtern" } },
  { path: "/monat/2026-09", heading: "September 2026", action: { role: "link" as const, name: /August 2026/ } },
  { path: "/import", heading: "Kontoauszug importieren", action: { role: "button" as const, name: "Importieren" } },
  { path: "/regeln", heading: "Regeln", action: { role: "button" as const, name: "Lieferando ist Restaurant" } },
  { path: "/konten", heading: "Konten", action: { role: "button" as const, name: "Umbenennen" } },
  { path: "/budgets", heading: "Budgets", action: { role: "button" as const, name: "Kategorie anlegen" } },
  { path: "/abos", heading: "Abos und feste Kosten", action: { role: "link" as const, name: "Abos" } },
  { path: "/hinweise", heading: "Hinweise", action: { role: "link" as const, name: "Übersicht" } },
  { path: "/pruefen", heading: "Prüfen", action: { role: "link" as const, name: "Überspringen" } },
  { path: "/banken", heading: "Banken", action: { role: "button" as const, name: "PayPal hinzufügen" } },
];

test.beforeAll(resetDb);

test("Demo-Daten importieren", async ({ page }) => {
  await importDemo(page);
});

for (const { path, heading, action } of PAGES) {
  test(`${path}: keine Konsolenfehler, kein Überlauf, barrierearm, per Tastatur bedienbar`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();

    await expectNoHorizontalOverflow(page);
    await expectNoSeriousA11yViolations(page);

    const target = page.getByRole(action.role, { name: action.name });
    await expectOnTop(target.first());
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      // WebKit only tabs to links with Alt+Tab unless "Tab highlights each item" is enabled.
      await page.keyboard.press(test.info().project.name === "mobile" ? "Alt+Tab" : "Tab");
      reached = await target.first().evaluate((el) => el === document.activeElement);
    }
    expect(reached, "Hauptaktion ist per Tastatur erreichbar").toBe(true);

    expect(errors).toEqual([]);
  });
}
