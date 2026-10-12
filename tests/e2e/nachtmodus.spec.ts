import { expect, test } from "./fixtures";
import { expectNoSeriousA11yViolations, importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("Nachtmodus folgt dem System, und jede Seite bleibt lesbar", async ({ page }) => {
  await importDemo(page);
  await page.emulateMedia({ colorScheme: "dark" });
  for (const path of ["/", "/transaktionen", "/budgets", "/ziele", "/abos", "/hinweise", "/pruefen", "/banken"]) {
    await page.goto(path);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background, path).toBe("rgb(25, 24, 21)");
    await expectNoSeriousA11yViolations(page);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(243, 239, 229)");
});
