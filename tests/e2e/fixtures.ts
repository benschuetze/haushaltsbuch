/**
 * Playwright's test with one change: after every page.goto the test waits until React has hydrated the page.
 * Typing into a server-rendered input before that is lost, which made tests flaky on slow CI runners.
 */
import { test as base } from "@playwright/test";

export { expect, type Locator, type Page } from "@playwright/test";

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (...args: Parameters<typeof goto>) => {
      const response = await goto(...args);
      await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
      return response;
    };
    await use(page);
  },
});
