import { expect, type Page, test } from "@playwright/test";
import { DEMO_URL, FAKE_BANK_URL, resetDb } from "./helpers";

/** Banks without a tile are found through the search below the tiles. */
async function connectTestbank(page: Page) {
  await page.getByText("Andere Bank suchen").click();
  await page.getByLabel(/^Bank \(/).fill("Testbank");
  await page.getByRole("button", { name: "Weiter zur Bank" }).click();
}

test.beforeEach(async () => {
  await resetDb();
  await fetch(`${FAKE_BANK_URL}/__reset`);
});

test("Bank verbinden: zur Bank und zurück, Konto entsteht, Umsätze sind da, erneuter Abruf ohne Duplikate", async ({
  page,
}) => {
  await page.goto("/banken");
  await connectTestbank(page);

  await expect(page).toHaveURL(/\/banken\?verbunden=4/);
  await expect(page.getByRole("status")).toHaveText("Verbunden. 4 neue Buchungen abgerufen.");
  const connection = page.getByTestId("connection");
  await expect(connection).toContainText("Testbank ··5678");
  await expect(connection.getByTestId("connection-status")).toHaveText("aktiv");

  await page.goto("/transaktionen");
  await expect(page.getByTestId("transaction")).toHaveCount(4);
  await expect(page.getByTestId("counterparty").filter({ hasText: "Arbeitgeber Muster GmbH" })).toBeVisible();

  await page.goto("/banken");
  await page.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(page.getByRole("status")).toHaveText("Testbank: 0 neue Buchungen, 1 vorgemerkt.");
});

test("Rücksprung ohne passenden state wird abgewiesen, nichts wird angelegt", async ({ page }) => {
  await page.goto("/bank/callback?state=ausgedacht&code=code-1");
  await expect(page).toHaveURL(/\/banken\?fehler=state/);
  await expect(page.getByRole("alert")).toContainText("ließ sich nicht zuordnen");
  await expect(page.getByTestId("connection")).toHaveCount(0);
});

test("Zugang abgelaufen: Glocke meldet es, Verbindung steht auf abgelaufen", async ({ page }) => {
  await page.goto("/banken");
  await connectTestbank(page);
  await expect(page).toHaveURL(/verbunden=/);

  await fetch(`${FAKE_BANK_URL}/__expire`);
  await page.getByRole("button", { name: "Jetzt abrufen" }).click();
  await expect(page.getByRole("alert")).toHaveText("Testbank: Zugang abgelaufen oder widerrufen.");
  await expect(page.getByTestId("connection-status")).toHaveText("abgelaufen");
  await page.getByTestId("notifications").locator("summary").click();
  await expect(page.getByRole("link", { name: "Bankzugang Testbank erneuern" })).toBeVisible();
});

test("Trennen: Zugang weg, Buchungen bleiben", async ({ page }) => {
  await page.goto("/banken");
  await connectTestbank(page);
  await page.getByRole("button", { name: "Trennen" }).click();
  await expect(page.getByRole("status")).toHaveText("Verbindung zu Testbank getrennt. Bisherige Buchungen bleiben.");
  await expect(page.getByTestId("connection-status")).toHaveText("getrennt");
  await page.goto("/transaktionen");
  await expect(page.getByTestId("transaction")).toHaveCount(4);
});

test("täglicher Abruf: ohne Geheimnis 401, mit Geheimnis nur Zahlen, keine Buchungsdaten", async ({
  page,
  request,
}) => {
  await page.goto("/banken");
  await connectTestbank(page);
  await expect(page).toHaveURL(/verbunden=/);

  expect((await request.get("/bank/sync")).status()).toBe(401);
  expect((await request.get("/bank/sync", { headers: { Authorization: "Bearer falsch" } })).status()).toBe(401);
  const ok = await request.get("/bank/sync", { headers: { Authorization: `Bearer ${process.env.E2E_CRON_SECRET}` } });
  expect(ok.status()).toBe(200);
  const body = await ok.text();
  expect(JSON.parse(body)).toEqual({ ok: true, connections: 1, inserted: 0, failed: 0 });
  expect(body).not.toMatch(/REWE|Gehalt|DE00/);
});

test("Datenschutz und Nutzungsbedingungen sind ohne Anmeldung erreichbar", async ({ browser }) => {
  const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await anon.newPage();
  await page.goto("/datenschutz");
  await expect(page.getByRole("heading", { name: "Datenschutzerklärung" })).toBeVisible();
  await page.goto("/nutzungsbedingungen");
  await expect(page.getByRole("heading", { name: "Nutzungsbedingungen" })).toBeVisible();
  await anon.close();
});

test.describe("Demo", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: DEMO_URL });
  test("ohne echte Bankanbindung: Kacheln da, keine Suche nach echten Banken", async ({ page }) => {
    await page.goto("/banken");
    await expect(page.getByRole("button", { name: "PayPal hinzufügen" })).toBeVisible();
    await expect(page.getByText("Andere Bank suchen")).toHaveCount(0);
  });
});
