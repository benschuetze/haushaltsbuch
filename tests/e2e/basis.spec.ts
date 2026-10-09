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
  { path: "/", heading: "Übersicht", action: { role: "link" as const, name: "Ganzen Monat ansehen" } },
  { path: "/transaktionen", heading: "Buchungen", action: { role: "button" as const, name: "Filtern" } },
  { path: "/monat/2026-09", heading: "September 2026", action: { role: "link" as const, name: /August 2026/ } },
  { path: "/import", heading: "Kontoauszug importieren", action: { role: "button" as const, name: "Importieren" } },
  { path: "/regeln", heading: "Regeln", action: { role: "button" as const, name: "Regel anlegen" } },
  { path: "/konten", heading: "Konten", action: { role: "button" as const, name: "Umbenennen" } },
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
