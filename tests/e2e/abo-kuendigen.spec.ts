import { expect, test } from "./fixtures";
import { DEMO_URL, importDemo, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

/** A made-up gym the app has no cancel page for; the latest booking labels its numbers. */
async function addClub() {
  await sql(`
    insert into transactions (account_id, import_id, booking_date, amount_cents, counterparty, purpose, raw, dedupe_hash, category_id, category_source)
    select t.account_id, t.import_id, d::date, -3990, 'Kraftwerk Fitness GmbH',
      case when d = '2026-10-05' then 'Beitrag Kundennr. 4711-0815 MREF: KW-99887766' else 'Beitrag' end,
      '{}'::jsonb, 'club-' || d, c.id, 'rule'
    from (select account_id, import_id from transactions limit 1) t, categories c,
      unnest(array['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05']) d
    where c.name = 'Freizeit';
    delete from meta where key = 'insights_refreshed_at';`);
}

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
  await addClub();
  await page.goto("/abos");
  await page.getByRole("button", { name: "Kraftwerk Fitness GmbH kündigen" }).click();
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

test("ohne Kündigungsseite: Kündigungsschreiben mit Nummern aus der Buchung, erst vollständig freigegeben", async ({
  page,
}) => {
  await importDemo(page);
  await addClub();
  await page.goto("/abos");
  await page.getByRole("button", { name: "Kraftwerk Fitness GmbH kündigen" }).click();
  const dialog = page.getByRole("dialog", { name: "Kraftwerk Fitness GmbH kündigen" });
  await dialog.getByRole("button", { name: "Kündigungsschreiben erstellen" }).click();

  const letter = dialog.getByTestId("cancel-letter");
  await expect(letter).toContainText(
    "Es fehlt noch: Dein Name, Straße und Hausnummer, PLZ und Ort, Anschrift des Anbieters.",
  );
  await expect(dialog.getByRole("button", { name: "Text kopieren" })).toBeDisabled();
  await expect(dialog.getByLabel("Kundennummer")).toHaveValue("4711-0815");
  await expect(dialog.getByLabel("SEPA-Mandatsreferenz (optional)")).toHaveValue("KW-99887766");

  await dialog.getByLabel("Anschrift des Anbieters").fill("Studiostraße 5\n54321 Sportstadt");
  await dialog.getByLabel("Dein Name").fill("Alex Beispiel");
  await dialog.getByLabel("Straße und Hausnummer").fill("Musterweg 1");
  await dialog.getByLabel("PLZ und Ort").fill("12345 Musterstadt");

  await expect(letter).toContainText("Kündigung – Kundennummer 4711-0815");
  await expect(letter).toContainText(
    "hiermit kündige ich den oben genannten Vertrag fristgerecht zum nächstmöglichen Zeitpunkt.",
  );
  await expect(letter).toContainText("Mandatsreferenz KW-99887766 widerrufe ich zum Vertragsende.");
  await expect(dialog.getByRole("link", { name: "Als E-Mail öffnen" })).toHaveAttribute(
    "href",
    /^mailto:\?subject=K%C3%BCndigung/,
  );

  await dialog.getByRole("button", { name: "Abgeschickt" }).click();
  await expect(dialog.getByRole("button", { name: "Ja, gekündigt" })).toBeVisible();
});
