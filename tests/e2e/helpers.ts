import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import pg from "pg";

export const DEMO_CSV = "beispieldaten/demo-umsaetze.csv";
export const E2E_PASSWORD = "e2e-test-passwort";
export const DEMO_URL = "http://127.0.0.1:5198";

/** Every spec starts from the same state: seeded categories and account, no bookings, no rules. */
export async function resetDb(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("truncate table rules, transactions, imports restart identity cascade");
    await client.query("delete from accounts where name <> 'Girokonto (Demo)'");
  } finally {
    await client.end();
  }
}

export async function importDemo(page: Page): Promise<void> {
  await page.goto("/import");
  await page.getByLabel("CSV-Datei").setInputFiles(DEMO_CSV);
  await page.getByRole("button", { name: "Importieren" }).click();
  await expect(page.getByRole("status", { name: "Ergebnis des Imports" })).toBeVisible();
}

export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, "Seite ist breiter als der Bildschirm").toBeLessThanOrEqual(client);
}

export async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length}×)`)).toEqual([]);
}

/** "Visible" is not enough when a sticky header or dialog could cover it: the element must be on top. */
export async function expectOnTop(locator: ReturnType<Page["locator"]>): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element hat keine Fläche");
  const onTop = await locator.evaluate(
    (el, { x, y }) => {
      const hit = document.elementFromPoint(x, y);
      return hit === el || el.contains(hit);
    },
    // boundingBox is relative to the viewport, same as elementFromPoint.
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(onTop).toBe(true);
}
