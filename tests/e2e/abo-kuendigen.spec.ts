import { expect, test } from "./fixtures";
import { DEMO_URL, importDemo, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

test("aus der Glocke kündigen: Pop-up öffnet die Kündigungsseite, danach ist das Abo als gekündigt vermerkt", async ({
  page,
}) => {
  await importDemo(page);
  await page.goto("/");
  await page.getByTestId("notifications").locator("summary").click();
  await page.getByRole("button", { name: "Spotify AB kündigen" }).click();

  // Tests never reach the real provider: the request is answered here, its address is what counts.
  const asked: string[] = [];
  await page.context().route("https://www.spotify.com/**", (route) => {
    asked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Kündigen</title>" });
  });
  const dialog = page.getByRole("dialog", { name: "Spotify AB kündigen" });
  const popup = page.waitForEvent("popup");
  await dialog.getByRole("button", { name: "Kündigungsseite öffnen" }).click();
  await (await popup).close();
  expect(asked).toEqual(["https://www.spotify.com/de/account/subscription/"]);

  await dialog.getByRole("button", { name: "Ja, gekündigt" }).click();
  await expect(dialog.getByRole("status")).toContainText("Bucht Spotify AB trotzdem ab, kommt sofort eine Warnung");
  await dialog.getByRole("button", { name: "Fertig" }).click();

  await page.getByTestId("notifications").locator("summary").click();
  await expect(page.getByRole("button", { name: "Spotify AB kündigen" })).toHaveCount(0);

  await page.goto("/abos");
  await expect(page.getByRole("list", { name: "Laufende Abos" })).not.toContainText("Spotify AB");
  const cancelled = page.getByTestId("cancelled").filter({ hasText: "Spotify AB" });
  await expect(cancelled.getByTestId("cancel-state")).toContainText("wird geprüft bis");
});

test("bucht es trotz Kündigung weiter ab, warnt die App rot in der Glocke und auf der Abo-Seite", async ({ page }) => {
  await importDemo(page);
  await page.goto("/abos");
  await page.getByRole("button", { name: "Spotify AB kündigen" }).click();
  await page.getByRole("button", { name: "Schon gekündigt" }).click();
  await page.getByRole("button", { name: "Ja, gekündigt" }).click();
  await expect(page.getByRole("dialog").getByRole("status")).toBeVisible();

  // The next Spotify charge arrives after the cancellation (bank sync or import).
  await sql(`
    update subscription_cancellations set cancelled_on = '2026-09-10';
    insert into transactions (account_id, import_id, booking_date, amount_cents, counterparty, purpose, raw, dedupe_hash)
    select account_id, import_id, '2026-10-07', -1099, 'Spotify AB', 'Spotify Premium', '{}'::jsonb, 'spotify-oct'
    from transactions limit 1;
    delete from meta where key = 'insights_refreshed_at';`);

  await page.goto("/abos");
  const cancelled = page.getByTestId("cancelled").filter({ hasText: "Spotify AB" });
  await expect(cancelled.getByTestId("cancel-state")).toHaveText("bucht weiter ab (07.10.2026)");
  await page.getByTestId("notifications").locator("summary").click();
  const bell = page.getByTestId("notifications");
  await expect(bell.getByRole("link", { name: "Spotify AB bucht trotz Kündigung weiter ab" })).toBeVisible();
  // One entry with one button, not a second "Abo erkannt" next to the warning.
  await expect(bell.getByRole("button", { name: "Spotify AB kündigen" })).toHaveCount(1);
  await expect(bell.getByText("Abo erkannt: Spotify AB")).toHaveCount(0);
});

test("Kündigung zurücknehmen bringt das Abo zurück in die Liste", async ({ page }) => {
  await importDemo(page);
  await page.goto("/abos");
  await page.getByRole("button", { name: "Anthropic PBC kündigen" }).click();
  await page.getByRole("button", { name: "Schon gekündigt" }).click();
  await page.getByRole("button", { name: "Ja, gekündigt" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Fertig" }).click();
  await page.getByRole("button", { name: "Zurücknehmen" }).click();
  await expect(page.getByRole("status")).toHaveText("Kündigung zurückgenommen.");
  await expect(page.getByRole("list", { name: "Laufende Abos" })).toContainText("Anthropic PBC");
});

test("unbekannter Anbieter: Suche nach dem Kündigungsbutton statt geratener Adresse", async ({ page }) => {
  await importDemo(page);
  await page.goto("/abos");
  await page.getByRole("button", { name: "Telekom Deutschland kündigen" }).click();
  await expect(page.getByRole("dialog")).toContainText("keine feste Kündigungsseite");
  await expect(page.getByRole("button", { name: "Kündigungsbutton suchen" })).toBeVisible();
});

test("Demo: Kündigen-Pop-up zeigt den Weg, speichert aber nichts", async ({ page }) => {
  // In tests the demo server reads the same database.
  await importDemo(page);
  await page.goto(`${DEMO_URL}/abos`);
  await page.getByRole("button", { name: "Spotify AB kündigen" }).click();
  await page.getByRole("button", { name: "Schon gekündigt" }).click();
  await expect(page.getByRole("button", { name: "In der Demo abgeschaltet" })).toBeDisabled();
});
