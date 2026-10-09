import { expect, test } from "@playwright/test";
import { DEMO_URL } from "./helpers";

test.describe("ohne Login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("jede Seite leitet auf den Login und danach zurück", async ({ page }) => {
    await page.goto("/regeln");
    await expect(page).toHaveURL(/\/login\?next=%2Fregeln/);
    await page.getByLabel("Passwort").fill("falsch");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("alert")).toHaveText("Passwort stimmt nicht.");
  });

  test("Schreiben ohne Login wird abgelehnt", async ({ request }) => {
    const response = await request.post("/transaktionen", {
      form: { intent: "confirm", transactionId: crypto.randomUUID() },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("Demo-Modus", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: DEMO_URL });

  test("lesen geht ohne Login", async ({ page }) => {
    await page.goto("/transaktionen");
    await expect(page.getByRole("heading", { name: "Buchungen" })).toBeVisible();
    await expect(page.getByText("Demo mit erfundenen Beispieldaten")).toBeVisible();
  });

  test("jeder schreibende Request wird mit 403 abgelehnt", async ({ request }) => {
    for (const path of ["/import", "/transaktionen", "/regeln", "/login", "/logout"]) {
      const response = await request.post(path, { form: { intent: "create" } });
      expect(response.status(), path).toBe(403);
    }
  });
});
