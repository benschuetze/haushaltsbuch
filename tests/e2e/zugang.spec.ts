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

  test("zum Ausprobieren: eine Regel anlegen geht, „Jetzt zurücksetzen“ räumt sie wieder weg", async ({ page }) => {
    await page.goto(`${DEMO_URL}/regeln`);
    await page.getByText("Regel selbst einstellen (für Profis)").click();
    const form = page.getByRole("region", { name: "Regel selbst einstellen" });
    await form.getByLabel("Muster").fill("kiosk-demo");
    await form.getByLabel("Kategorie").selectOption({ label: "Sonstiges" });
    await form.getByRole("button", { name: "Regel anlegen" }).click();
    await expect(page.getByRole("heading", { name: "Deine Regeln (1)" })).toBeVisible();

    await page.getByRole("button", { name: "Jetzt zurücksetzen" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Zurückgesetzt." })).toBeVisible();
    await page.goto(`${DEMO_URL}/regeln`);
    await expect(page.getByRole("heading", { name: "Deine Regeln (0)" })).toBeVisible();
  });

  test("zum Ausprobieren: eine Beispieldatei herunterladen und importieren", async ({ page }) => {
    await page.goto(`${DEMO_URL}/import`);
    const demo = page.getByTestId("demo-import");
    await expect(demo).toContainText("keine echten Kontoauszüge");
    await expect(demo.getByRole("link", { name: "Sparkasse (CSV)" })).toHaveAttribute(
      "href",
      "/beispiele/sparkasse.csv",
    );
    const sample = await page.request.get(`${DEMO_URL}/beispiele/sparkasse.csv`);
    expect(sample.status()).toBe(200);

    await page.getByLabel("Kontoauszüge").setInputFiles("public/beispiele/sparkasse.csv");
    await page.getByRole("button", { name: "Importieren" }).click();
    await expect(page.getByRole("status", { name: /^Ergebnis für/ })).toBeVisible();
  });

  test("Login und Logout gibt es in der Demo nicht", async ({ request }) => {
    for (const path of ["/login", "/logout"]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(response.status(), path).toBe(302);
    }
  });
});
