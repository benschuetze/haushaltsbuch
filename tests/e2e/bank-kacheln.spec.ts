import { expect, test } from "@playwright/test";
import { DEMO_URL, FAKE_BANK_URL, resetDb } from "./helpers";

test.beforeEach(async () => {
  await resetDb();
  await fetch(`${FAKE_BANK_URL}/__reset`);
});

test("Kachel mit Live-Anbindung: zwei Klicks bis zur Bank und zurück", async ({ page }) => {
  await page.goto("/banken");
  const tile = page.getByRole("button", { name: "DKB hinzufügen" });
  await expect(tile).toContainText("Live");
  await tile.click();
  await page.getByRole("dialog").getByRole("button", { name: "Weiter zu DKB" }).click();

  await expect(page).toHaveURL(/\/banken\?verbunden=4/);
  await expect(page.getByTestId("connection")).toContainText("DKB");
});

test("Sparkasse: erst die richtige auswählen, Suche filtert die Liste", async ({ page }) => {
  await page.goto("/banken");
  await page.getByRole("button", { name: "Sparkasse hinzufügen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Welche Sparkasse? (2 verfügbar)")).toBeFocused();
  await dialog.getByLabel(/Welche Sparkasse/).fill("beispiel");
  await expect(dialog.getByRole("button", { name: "Sparkasse Musterstadt" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Sparkasse Beispielhausen" }).click();

  await expect(page).toHaveURL(/verbunden=/);
  await expect(page.getByTestId("connection")).toContainText("Sparkasse Beispielhausen");
});

test("PayPal: echte Umsätze per Datei, mit Export-Link, direkt im Pop-up importieren", async ({ page }) => {
  await page.goto("/banken");
  const tile = page.getByRole("button", { name: "PayPal hinzufügen" });
  await expect(tile).toContainText("Mock");
  await tile.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Echte Umsätze per Datei-Import").click();
  await expect(dialog.getByRole("link", { name: "Direkt zum Export" })).toHaveAttribute(
    "href",
    "https://www.paypal.com/reports/dlog",
  );
  await expect(dialog.getByRole("button", { name: "Importieren" })).toBeDisabled();
  await dialog.getByLabel("CSV-Datei auswählen").setInputFiles("beispieldaten/banken/dkb.csv");
  await dialog.getByRole("button", { name: "Importieren" }).click();

  await expect(page).toHaveURL(/\/import$/);
  await expect(page.getByRole("status", { name: "Ergebnis für dkb.csv" }).getByTestId("import-inserted")).toHaveText(
    "9",
  );
});

test("Escape schließt das Pop-up, eine andere Kachel öffnet ihr eigenes", async ({ page }) => {
  await page.goto("/banken");
  await page.getByRole("button", { name: "Revolut hinzufügen" }).click();
  await expect(page.getByRole("dialog", { name: "Revolut hinzufügen" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "N26 hinzufügen" }).click();
  await expect(page.getByRole("dialog", { name: "N26 hinzufügen" })).toBeVisible();
});

test("Demo spielt die Verbindung nach, ohne etwas zu verbinden", async ({ page }) => {
  await page.goto(`${DEMO_URL}/banken`);
  await page.getByRole("button", { name: "DKB hinzufügen" }).click();
  await page.getByRole("button", { name: "Verbindung testen (Demo)" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("Demo, nichts wurde verbunden");
  await expect(page.getByTestId("connection")).toHaveCount(0);
});

test("Kacheln brechen auf dem Handy um, nichts ragt seitlich heraus", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/banken");
  await expect(page.getByRole("button", { name: "PayPal hinzufügen" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("Live-Anbindung noch nicht freigeschaltet: klarer Hinweis, alle Kacheln laufen per Datei", async ({ page }) => {
  await fetch(`${FAKE_BANK_URL}/__inactive`);
  await page.goto("/banken");
  await expect(page.getByText("noch nicht freigeschaltet")).toBeVisible();
  await expect(page.getByRole("button", { name: "DKB hinzufügen" })).toContainText("Mock");
  await page.getByRole("button", { name: "DKB hinzufügen" }).click();
  await expect(page.getByRole("dialog").getByTestId("mock-banner")).toBeVisible();
});

test("Mock: Pop-up sagt oben klar „Mockdaten“, Verbinden legt ein gekennzeichnetes Konto an, Abo wird erkannt, Entfernen räumt auf", async ({
  page,
}) => {
  await page.goto("/banken");
  await page.getByRole("button", { name: "PayPal hinzufügen" }).click();
  const dialog = page.getByRole("dialog", { name: "PayPal hinzufügen" });
  await expect(dialog.getByTestId("mock-banner")).toHaveText("Mockdaten: keine echte Verbindung zu PayPal");
  await dialog.getByRole("button", { name: "Mit PayPal verbinden (Mock)" }).click();
  await expect(dialog.getByRole("status")).toContainText("Verbunden (Mock):");
  await expect(dialog.getByRole("status")).toContainText("„PayPal (Mock)“");
  await page.keyboard.press("Escape");

  await expect(page.getByRole("button", { name: "PayPal hinzufügen" })).toContainText("Mock verbunden");
  const mock = page.getByTestId("mock-connection");
  await expect(mock).toContainText("PayPal (Mock)");
  await page.getByTestId("notifications").locator("summary").click();
  await expect(page.getByRole("link", { name: "Abo erkannt: Netflix" })).toBeVisible();
  await page.keyboard.press("Escape");

  await mock.getByRole("button", { name: "Entfernen" }).click();
  await expect(page.getByRole("status")).toHaveText("„PayPal (Mock)“ mit allen Mock-Buchungen entfernt.");
  await expect(page.getByTestId("mock-connection")).toHaveCount(0);
  await page.goto("/transaktionen");
  await expect(page.getByText("Netflix")).toHaveCount(0);
});

test("Suche filtert beim Tippen, auch über frühere Namen; Filter zeigt nur eine Art", async ({ page }) => {
  await page.goto("/banken");
  const tiles = page.getByRole("button", { name: / hinzufügen$/ });
  await page.getByLabel("Bank suchen").fill("barc");
  await expect(tiles).toHaveCount(1);
  await expect(tiles).toHaveAccessibleName("easybank hinzufügen");
  await page.getByLabel("Bank suchen").fill("xyzbank");
  await expect(tiles).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Nichts gefunden");

  await page.getByLabel("Bank suchen").fill("");
  await page.getByRole("button", { name: "Kreditkarten" }).click();
  await expect(page.getByRole("button", { name: "Kreditkarten" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "American Express hinzufügen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sparkasse hinzufügen" })).toHaveCount(0);
});

test("ohne Suche und Filter: nach Art gruppiert, jede Kachel mit echtem Logo", async ({ page }) => {
  await page.goto("/banken");
  for (const label of ["Banken", "Neobanken", "Kreditkarten", "Bezahldienste", "Broker"]) {
    await expect(page.getByRole("region", { name: label, exact: true })).toBeVisible();
  }
  // Logos load lazily (off-screen ones only on scroll), so each address is checked directly.
  const sources = await page
    .locator('img[src^="/logos/"]')
    .evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src") ?? ""));
  expect(sources.length).toBeGreaterThan(30);
  const broken: string[] = [];
  for (const src of sources) {
    const r = await page.request.get(src);
    if (!r.ok() || r.headers()["content-type"] !== "image/png") broken.push(src);
  }
  expect(broken).toEqual([]);
});
