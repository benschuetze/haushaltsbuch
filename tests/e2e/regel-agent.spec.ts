import { expect, test } from "./fixtures";
import { DEMO_URL, importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("ein Satz wird zur Regel: Vorschau zeigt Treffer, Übernehmen ordnet die Buchungen zu", async ({ page }) => {
  await importDemo(page);
  await page.goto("/regeln");
  await page.getByLabel("Was soll die Regel tun?").fill("Alles vom Zoo ist Freizeit");
  await page.getByRole("button", { name: "Vorschlag" }).click();

  const proposal = page.getByTestId("rule-proposal");
  await expect(proposal).toContainText("Wenn der Empfänger enthält „Zoo“ → Freizeit");
  await expect(proposal.getByTestId("rule-preview")).toHaveText(/^Passt auf 2 Buchungen/);
  await expect(proposal).toContainText("verstanden ohne KI");
  await proposal.getByRole("button", { name: "Übernehmen" }).click();

  await expect(page.getByRole("status")).toContainText("1 Regel gespeichert.");
  await expect(page.getByTestId("rule")).toContainText("Wenn der Empfänger enthält „Zoo“ → Freizeit");
  await expect(page.getByTestId("rule-proposal")).toHaveCount(0);
});

test("mehrere Händler in einem Satz, Kategorie vor dem Übernehmen änderbar", async ({ page }) => {
  await importDemo(page);
  await page.goto("/regeln");
  await page.getByRole("button", { name: "Netflix und Spotify sind Abos" }).click();
  const proposal = page.getByTestId("rule-proposal");
  await expect(proposal.getByTestId("rule-preview")).toHaveCount(2);
  await proposal.getByLabel("Kategorie").first().selectOption({ label: "Freizeit" });
  await proposal.getByRole("button", { name: "Alle 2 übernehmen" }).click();

  await expect(page.getByRole("status")).toContainText("2 Regeln gespeichert.");
  await expect(page.getByTestId("rule")).toHaveCount(2);
  await expect(page.getByTestId("rule").filter({ hasText: "„Netflix“" })).toContainText("→ Freizeit");
  await expect(page.getByTestId("rule").filter({ hasText: "„Spotify“" })).toContainText("→ Abos & Software");
});

test("ein neuer Wunsch schlägt eine ältere, widersprechende Regel", async ({ page }) => {
  await importDemo(page);
  await page.goto("/regeln");
  await page.getByLabel("Was soll die Regel tun?").fill("Spotify ist Freizeit");
  await page.getByRole("button", { name: "Vorschlag" }).click();
  await page.getByTestId("rule-proposal").getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByRole("status")).toContainText("gespeichert");

  await page.getByLabel("Was soll die Regel tun?").fill("Spotify ist ein Abo");
  await page.getByRole("button", { name: "Vorschlag" }).click();
  await expect(page.getByTestId("rule-preview")).toContainText("2 bekommen dadurch die neue Kategorie");
  // The category box must show the new proposal, not the one from the previous sentence about Spotify.
  await expect(page.getByTestId("rule-proposal").getByLabel("Kategorie").locator("option:checked")).toHaveText(
    "Abos & Software",
  );
  await page.getByTestId("rule-proposal").getByRole("button", { name: "Übernehmen" }).click();
  await expect(page.getByTestId("rule")).toHaveCount(2);

  await page.goto("/transaktionen?monat=2026-09");
  const spotify = page.getByLabel("Kategorie für Spotify AB am 07.09.2026");
  await expect(spotify.locator("option:checked")).toHaveText("Abos & Software");
});

test("unverständlicher Satz: freundlicher Hinweis statt geratener Regel", async ({ page }) => {
  await page.goto("/regeln");
  await page.getByLabel("Was soll die Regel tun?").fill("mach das mal schöner");
  await page.getByRole("button", { name: "Vorschlag" }).click();
  await expect(page.getByRole("alert")).toContainText("nicht verstanden");
  await expect(page.getByTestId("rule-proposal")).toHaveCount(0);
});

test("Demo: Agent sichtbar, aber abgeschaltet", async ({ page }) => {
  await page.goto(`${DEMO_URL}/regeln`);
  await expect(page.getByLabel("Was soll die Regel tun?")).toBeDisabled();
  await expect(page.getByText("In der Demo lassen sich keine Regeln anlegen.")).toBeVisible();
});

test("eingebaute Regeln sind sichtbar, damit das Badge „Regel“ ohne eigene Regel erklärt ist", async ({ page }) => {
  await page.goto("/regeln");
  const builtin = page.getByTestId("builtin-rules");
  await expect(builtin).toContainText("Umbuchung");
  await expect(builtin).toContainText("Restaurant & Lieferdienst: Lieferando");
  await expect(builtin).toContainText("Abos & Software: Netflix, Disney+, Spotify");
});
