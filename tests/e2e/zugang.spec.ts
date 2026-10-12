import { expect, test } from "./fixtures";
import { DEMO_URL, resetDb } from "./helpers";

// Failed logins from other specs would otherwise trip the throttle here.
test.beforeEach(resetDb);

test.describe("ohne Login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("Impressum ist ohne Login erreichbar und sagt ehrlich, wenn Angaben fehlen", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Impressum" }).click();
    await expect(page).toHaveURL(/\/impressum$/);
    await expect(page.getByRole("heading", { name: "Impressum" })).toBeVisible();
    // The test instance has no operator configured, as a fresh install would not.
    await expect(page.getByTestId("imprint-missing")).toBeVisible();
  });

  test("jede Seite leitet auf den Login und danach zurück", async ({ page }) => {
    await page.goto("/regeln");
    await expect(page).toHaveURL(/\/login\?next=%2Fregeln/);
    await page.getByLabel("Passwort").fill("falsch");
    await page.getByRole("button", { name: "Anmelden" }).click();
    await expect(page.getByRole("alert")).toHaveText("Passwort stimmt nicht.");
  });

  test("Schreiben ohne Login wird abgelehnt", async ({ request }) => {
    // Same-origin, so the CSRF check passes and the missing login is what stops it.
    const response = await request.post("/buchungen", {
      form: { intent: "confirm", transactionId: crypto.randomUUID() },
      headers: { Origin: "http://127.0.0.1:5199" },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("Demo-Modus", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: DEMO_URL });

  test("lesen geht ohne Login", async ({ page }) => {
    await page.goto("/buchungen");
    await expect(page.getByRole("heading", { name: "Buchungen" })).toBeVisible();
    await expect(page.getByText("Demo mit erfundenen Beispieldaten")).toBeVisible();
    await expect(page.getByRole("link", { name: "Code und Architektur auf GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/benschuetze/haushaltsbuch",
    );
  });

  test("jeder schreibende Request wird mit 403 abgelehnt", async ({ request }) => {
    for (const path of ["/import", "/buchungen", "/regeln", "/login", "/logout"]) {
      const response = await request.post(path, { form: { intent: "create" } });
      expect(response.status(), path).toBe(403);
    }
  });
});
