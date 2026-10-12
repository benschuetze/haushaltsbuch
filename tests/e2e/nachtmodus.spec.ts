import { expect, test } from "./fixtures";
import { DEMO_URL, expectNoSeriousA11yViolations, importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("Nachtmodus folgt dem System, und jede Seite bleibt lesbar", async ({ page }) => {
  await importDemo(page);
  await page.emulateMedia({ colorScheme: "dark" });
  for (const path of ["/", "/buchungen", "/budgets", "/ziele", "/abos", "/hinweise", "/pruefen", "/banken"]) {
    await page.goto(path);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background, path).toBe("rgb(25, 24, 21)");
    await expectNoSeriousA11yViolations(page);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(243, 239, 229)");
});

const background = (page: import("@playwright/test").Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const DARK = "rgb(25, 24, 21)";
const LIGHT = "rgb(243, 239, 229)";

test("Schalter: Dunkel bei hellem System, Hell bei dunklem System, die Wahl bleibt nach dem Neuladen", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/budgets");
  await page.getByRole("button", { name: "Dunkel" }).click();
  await expect(page).toHaveURL(/\/budgets$/);
  await expect.poll(() => background(page)).toBe(DARK);
  await expect(page.getByRole("button", { name: "Dunkel" })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  expect(await background(page)).toBe(DARK);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "Hell" }).click();
  await expect.poll(() => background(page)).toBe(LIGHT);

  await page.getByRole("button", { name: "System" }).click();
  await expect.poll(() => background(page)).toBe(DARK);
  await expectNoSeriousA11yViolations(page);
});

test("auch die schreibgeschützte Demo lässt umschalten, es ist nur ein Cookie", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(`${DEMO_URL}/`);
  await page.getByRole("button", { name: "Dunkel" }).click();
  await expect.poll(() => background(page)).toBe(DARK);
});
