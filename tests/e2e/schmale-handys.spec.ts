import { expect, test } from "./fixtures";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

// The narrowest phones still sold (320) and the common size (390).
for (const width of [320, 390]) {
  test(`${width} px: Beträge passen in die Kacheln, keine Seite scrollt seitwärts`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await importDemo(page);
    await page.goto("/");
    for (const id of ["income", "expenses"]) {
      const amount = page.getByTestId(id);
      const fits = await amount.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(fits, `${id} passt in die Kachel`).toBe(true);
    }
    for (const path of ["/", "/buchungen", "/budgets", "/ziele", "/abos", "/banken", "/monat/2026-09"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} scrollt seitwärts`).toBeLessThanOrEqual(0);
    }
  });

  test(`${width} px: Banken mit Suche oben und gleich hohen Kacheln`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/banken");
    const search = page.getByLabel("Bank suchen");
    const firstTile = page.getByRole("region", { name: "Banken" }).getByRole("button").first();
    expect((await search.boundingBox())?.y ?? 0).toBeLessThan((await firstTile.boundingBox())?.y ?? 0);
    expect((await search.boundingBox())?.y ?? 9999, "Suche ohne Scrollen sichtbar").toBeLessThan(800);

    const heights = await page
      .getByRole("region", { name: "Banken" })
      .getByRole("listitem")
      .evaluateAll((items) =>
        items.map((li) => Math.round((li.firstElementChild as HTMLElement).getBoundingClientRect().height)),
      );
    // "Deutsche Bank" breaks onto two lines; its tile must not stick out of the row.
    expect(new Set(heights).size, `Höhen: ${[...new Set(heights)].join(", ")}`).toBe(1);
  });
}
