import { expect, test } from "./fixtures";
import { DEMO_URL, E2E_CAPTURE_TOKEN, resetDb } from "./helpers";

test.beforeEach(resetDb);

const auth = { Authorization: `Bearer ${E2E_CAPTURE_TOKEN}` };

// A fresh context carries no login cookie and no Origin header, like an iOS Shortcut.
test("ein Kurzbefehl bucht ohne Login, die Buchung wartet in „prüfen“, derselbe Schlüssel bucht nicht doppelt", async ({
  page,
  playwright,
  baseURL,
}) => {
  const shortcut = await playwright.request.newContext({ baseURL, extraHTTPHeaders: auth });
  const body = { text: "hab 7 Euro für Döner gezahlt", key: "e2e-key-1" };

  const first = await shortcut.post("/api/capture", { data: body });
  expect(first.status()).toBe(201);
  expect(await first.json()).toMatchObject({ amountCents: -700, account: "Bar", needsReview: true });

  const again = await shortcut.post("/api/capture", { data: body });
  expect(again.status()).toBe(200);

  await page.goto("/buchungen?pruefen=1");
  const rows = page.getByTestId("transaction").filter({ hasText: "Döner" });
  await expect(rows).toHaveCount(1);
  await expect(rows.getByText("−7,00 €")).toBeVisible();
  await shortcut.dispose();
});

test("falsches Token: 401, und es wird nichts gebucht", async ({ page, playwright, baseURL }) => {
  const shortcut = await playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: "Bearer falsch" },
  });
  const response = await shortcut.post("/api/capture", { data: { text: "7 Euro Döner", key: "e2e-key-2" } });
  expect(response.status()).toBe(401);

  await page.goto("/buchungen?pruefen=1");
  await expect(page.getByTestId("transaction")).toHaveCount(0);
  await shortcut.dispose();
});

test("Demo: Schreiben verweigert, auch mit richtigem Token", async ({ playwright }) => {
  const shortcut = await playwright.request.newContext({ baseURL: DEMO_URL, extraHTTPHeaders: auth });
  const response = await shortcut.post("/api/capture", { data: { text: "7 Euro Döner", key: "e2e-key-3" } });
  expect(response.status()).toBe(403);
  await shortcut.dispose();
});
