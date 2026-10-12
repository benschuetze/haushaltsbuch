import { expect, test } from "./fixtures";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

/** Smaller than 16px and iOS Safari zooms into the field on focus; the page then stays shifted sideways. */
async function smallFields(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("input:not([type=hidden]):not([type=file]):not([type=checkbox]), select, textarea")]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => Number.parseFloat(getComputedStyle(el).fontSize) < 16)
      .map(
        (el) =>
          `${location.pathname}: ${el.getAttribute("aria-label") ?? el.getAttribute("name") ?? el.id ?? el.tagName}`,
      ),
  );
}

test("Handy: kein Eingabefeld unter 16 px, sonst zoomt iOS beim Tippen hinein", async ({ page, isMobile }) => {
  test.skip(!isMobile, "betrifft nur Handys");
  await importDemo(page);
  const small: string[] = [];
  for (const path of ["/", "/transaktionen", "/budgets", "/ziele", "/regeln", "/banken", "/import"]) {
    await page.goto(path);
    small.push(...(await smallFields(page)));
  }
  await page.goto("/transaktionen");
  await page.getByRole("button", { name: "Assistent öffnen" }).last().click();
  small.push(...(await smallFields(page)));
  expect(small).toEqual([]);
});

test("Handy: der Assistent ist ein Vollbild, Seite und Tab-Leiste liegen nicht dazwischen", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "betrifft nur Handys");
  await page.goto("/transaktionen");
  await page.getByRole("button", { name: "Assistent öffnen" }).last().click();
  const panel = page.getByRole("dialog", { name: "Assistent" });
  const box = await panel.boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error("kein Panel");
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(Math.round(box.width)).toBe(vp.width);
  expect(Math.round(box.height)).toBe(vp.height);
  // The tab bar is covered, the input is the last thing above the keyboard.
  const input = await panel.getByRole("textbox").boundingBox();
  expect(input && input.y + input.height).toBeGreaterThan(vp.height - 80);
  await panel.getByRole("button", { name: "Assistent schließen" }).click();
  await expect(panel).toHaveCount(0);
});

test("Handy: Beträge passen in die Kacheln, auch vierstellige mit Minus", async ({ page, isMobile }) => {
  test.skip(!isMobile, "betrifft nur Handys");
  await importDemo(page);
  // Smaller than the iPhone 13 profile: many Android phones and the iPhone SE/mini are 360–375 px wide.
  await page.setViewportSize({ width: 360, height: 780 });
  for (const path of ["/", "/monat/2026-09"]) {
    await page.goto(path);
    const overflowing = await page
      .locator("dd")
      .evaluateAll((dds) => dds.filter((dd) => dd.scrollWidth > dd.clientWidth + 1).map((dd) => dd.textContent));
    expect(overflowing, path).toEqual([]);
  }
});

test("Handy: Budgets in der Tab-Leiste, Sparziele unter „Mehr“", async ({ page, isMobile }) => {
  test.skip(!isMobile, "betrifft nur Handys");
  await page.goto("/");
  const bar = page.getByRole("navigation", { name: "Schnellnavigation" });
  await expect(bar.getByRole("link", { name: "Budgets" })).toBeVisible();
  await bar.getByText("Mehr", { exact: true }).click();
  await expect(bar.getByRole("link", { name: "Sparziele" })).toBeVisible();
});
