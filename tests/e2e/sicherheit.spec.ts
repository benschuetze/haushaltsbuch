import { expect, test } from "@playwright/test";
import { resetDb } from "./helpers";

test.beforeEach(resetDb);

test("Seiten kommen mit strenger CSP und Schutz-Headern, ohne dass etwas blockiert wird", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const response = await page.goto("/");
  const h = response?.headers() ?? {};
  expect(h["content-security-policy"]).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
  expect(h["referrer-policy"]).toBe("no-referrer");
  // The app still works: hydrated, navigable, no CSP violation in the console.
  await page.getByRole("link", { name: "Budgets" }).click();
  await expect(page.getByRole("heading", { name: "Budgets", level: 1 })).toBeVisible();
  expect(errors.filter((e) => /Content Security Policy|Refused to/.test(e))).toEqual([]);
});

test("jede Antwort hat eine neue Nonce", async ({ request }) => {
  const a = (await request.get("/login")).headers()["content-security-policy"];
  const b = (await request.get("/login")).headers()["content-security-policy"];
  expect(a).not.toBe(b);
});

test("schreibende Anfrage von einer fremden Seite wird abgelehnt, auch mit gültiger Anmeldung", async ({ page }) => {
  await page.goto("/");
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "hb_session")).toBe(true);
  // React Router itself rejects a foreign Origin (400) before our middleware; ours catches missing headers (403).
  const fromEvil = await page.request.post("/budgets", {
    form: { intent: "createCategory", name: "Angreifer", amount: "" },
    headers: { Origin: "https://evil.example" },
  });
  expect([400, 403]).toContain(fromEvil.status());
  const noOrigin = await page.request.post("/budgets", {
    form: { intent: "createCategory", name: "Angreifer", amount: "" },
  });
  expect(noOrigin.status()).toBe(403);
  await page.goto("/budgets");
  await expect(page.getByText("Angreifer")).toHaveCount(0);
});

test.describe("ohne Anmeldung", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("nach fünf falschen Passwörtern ist der Login 15 Minuten gesperrt, auch für das richtige", async ({ page }) => {
    await page.goto("/login");
    for (let i = 0; i < 5; i++) {
      await page.getByLabel("Passwort").fill(`falsch-${i}`);
      await page.getByRole("button", { name: "Anmelden" }).click();
      await expect(page.getByRole("alert")).toHaveText("Passwort stimmt nicht.");
    }
    await page.getByLabel("Passwort").fill("e2e-test-passwort");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("alert")).toHaveText("Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.");
    await expect(page).toHaveURL(/\/login/);
  });
});
