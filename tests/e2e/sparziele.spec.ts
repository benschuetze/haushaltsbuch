import { expect, test } from "./fixtures";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

/** "−1.234,56 €" → -123456; the app writes negatives with a real minus sign (U+2212). */
function cents(text: string): number {
  const sign = /[−-]/.test(text) ? -1 : 1;
  return sign * Math.round(Number(text.replace(/[^\d,]/g, "").replace(",", ".")) * 100);
}

test("Ziel anlegen: Monatsrate steht da, das Tagesbudget wird kleiner, Einzahlen füllt den Balken", async ({
  page,
}) => {
  await importDemo(page);
  // The free sum, not today's share: with the test data's dates the share can already be 0 €.
  const free = async () => {
    await page.goto("/");
    await page.getByText("Wie gerechnet?").click();
    return cents((await page.getByText(/^Ergibt /).innerText()).split(",").slice(0, 2).join(","));
  };
  const before = await free();

  await page.goto("/ziele");
  await page.getByLabel("Wofür?").fill("Mallorca");
  await page.getByLabel("Betrag (€)").fill("800");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("status")).toContainText("Sparziel „Mallorca“ angelegt");
  await expect(page.getByLabel("Wofür?")).toHaveValue("");
  const goal = page.getByTestId("goal").filter({ hasText: "Mallorca" });
  await expect(goal.getByTestId("goal-plan")).toContainText("80,00 € im Monat");

  expect(before - (await free())).toBe(8000);
  await expect(page.getByText("Sparziel Mallorca")).toBeVisible();

  await page.goto("/ziele");
  await goal.getByRole("button", { name: "Einzahlen" }).click();
  await expect(page.getByRole("status")).toHaveText("80,00 € zurückgelegt.");
  await expect(goal.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
  await expect(goal.getByTestId("goal-plan")).toContainText("diesen Monat erledigt");
});

test("Ziel erreicht: Feier und Trophäe", async ({ page }) => {
  await page.goto("/ziele");
  await page.getByLabel("Wofür?").fill("Kopfhörer");
  await page.getByLabel("Betrag (€)").fill("120");
  await page.getByRole("button", { name: "Anlegen" }).click();
  const goal = page.getByTestId("goal").filter({ hasText: "Kopfhörer" });
  await goal.getByLabel("Zurückgelegt (€)").fill("120");
  await goal.getByRole("button", { name: "Einzahlen" }).click();
  await expect(page.getByRole("status")).toHaveText("Ziel erreicht!");
  await expect(page.getByRole("list", { name: "Erreichte Sparziele" })).toContainText("Kopfhörer");
  await expect(page.getByTestId("goal")).toHaveCount(0);
});

test("ungültiger Betrag: verständlicher Hinweis", async ({ page }) => {
  await page.goto("/ziele");
  await page.getByLabel("Wofür?").fill("Test");
  await page.getByLabel("Betrag (€)").fill("viel");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("alert")).toHaveText("Bitte einen Betrag wie 800 oder 49,90 eingeben.");
});

test("Zieldatum: Monate nach Jahr gruppiert, Ziel mit Datum anlegen", async ({ page }) => {
  await page.goto("/ziele");
  const due = page.getByLabel("Bis wann? (optional)");
  await expect(due).toHaveValue("");
  await expect(due.locator("option").first()).toHaveText("ohne festes Datum");
  // Five years in groups instead of one list of 60 entries.
  const years = await due.locator("optgroup").evaluateAll((g) => g.map((x) => x.getAttribute("label")));
  expect(years.length).toBeGreaterThanOrEqual(5);
  expect(years.every((y) => /^\d{4}$/.test(y ?? ""))).toBe(true);
  await expect(due.locator("optgroup").first().locator("option").first()).toHaveText(/^[A-ZÄÖÜ][a-zäöü]+$/);

  const nextYear = String(Number(years[0]) + 1);
  await page.getByLabel("Wofür?").fill("Fahrrad");
  await page.getByLabel("Betrag (€)").fill("600");
  await due.selectOption(`${nextYear}-06`);
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByTestId("goal").filter({ hasText: "Fahrrad" })).toContainText(`bis Juni ${nextYear}`);
});

test("Sparauftrag wird zum Ziel: Vorschlag übernehmen, Tagesbudget bleibt gleich, Vorschlag verschwindet", async ({
  page,
}) => {
  await importDemo(page);
  const free = async () => {
    await page.goto("/");
    await page.getByText("Wie gerechnet?").click();
    return cents((await page.getByText(/^Ergibt /).innerText()).split(",").slice(0, 2).join(","));
  };
  const before = await free();

  await page.goto("/ziele");
  const plan = page.getByTestId("savings-plan");
  await expect(plan).toContainText("300,00 €");
  await expect(plan).toContainText("Eigenes Tagesgeld");
  await plan.getByRole("button", { name: "Als Ziel übernehmen" }).click();
  await expect(page.getByLabel("Wofür?")).toBeFocused();
  await expect(page.getByLabel("Betrag (€)")).toHaveValue("3600");
  await page.getByLabel("Wofür?").fill("Notgroschen");
  await page.getByRole("button", { name: "Anlegen" }).click();
  await expect(page.getByRole("status")).toContainText("Sparziel „Notgroschen“ angelegt");
  await expect(page.getByTestId("goal").filter({ hasText: "Notgroschen" })).toContainText(
    "300,00 € im Monat per Dauerauftrag",
  );
  await expect(page.getByTestId("savings-plan")).toHaveCount(0);

  // The order was already planned in; as a goal it is planned in once, not twice.
  expect(await free()).toBe(before);
});
