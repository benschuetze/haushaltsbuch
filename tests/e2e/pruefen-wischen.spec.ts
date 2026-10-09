import { expect, type Locator, test } from "./fixtures";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

/** A finger drag across the card: pointer events of type touch, like on a phone. */
async function swipe(card: Locator, dx: number) {
  const box = await card.boundingBox();
  if (!box) throw new Error("Karte nicht sichtbar");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const opts = (clientX: number) => ({ pointerType: "touch", isPrimary: true, clientX, clientY: y, bubbles: true });
  await card.dispatchEvent("pointerdown", opts(x));
  for (const step of [0.25, 0.5, 0.75, 1]) await card.dispatchEvent("pointermove", opts(x + dx * step));
  await card.dispatchEvent("pointerup", opts(x + dx));
}

test("nach rechts wischen übernimmt den Vorschlag, nach links kommt die nächste", async ({ page }) => {
  await importDemo(page);
  await page.goto("/pruefen");
  await expect(page.getByTestId("review-counterparty")).toHaveText("dm-drogerie markt");
  await expect(page.getByRole("button", { name: "Passt: Haushalt" })).toBeVisible();

  await swipe(page.getByTestId("review-card"), 200);
  const dialog = page.getByRole("dialog", { name: "Gespeichert" });
  await expect(dialog).toContainText("„dm-drogerie markt“ ist ab jetzt immer Haushalt");
  await dialog.getByRole("button", { name: "Weiter" }).click();

  await expect(page.getByTestId("review-counterparty")).toHaveText("PayPal Europe");
  await swipe(page.getByTestId("review-card"), -200);
  await expect(page).toHaveURL(/skip=/);
  await expect(page.getByRole("heading", { name: "Alles geprüft" })).toBeVisible();
});

test("schneller Wischer (alle Bewegungen vor dem nächsten Render) zählt trotzdem", async ({ page }) => {
  await importDemo(page);
  await page.goto("/pruefen");
  const card = page.getByTestId("review-card");
  const box = await card.boundingBox();
  if (!box) throw new Error("Karte nicht sichtbar");
  // All events in one task, so React cannot render in between.
  await card.evaluate(
    (el, x) => {
      const ev = (type: string, clientX: number) =>
        new PointerEvent(type, { pointerType: "touch", isPrimary: true, clientX, bubbles: true });
      el.dispatchEvent(ev("pointerdown", x));
      el.dispatchEvent(ev("pointermove", x - 250));
      el.dispatchEvent(ev("pointerup", x - 250));
    },
    box.x + box.width / 2,
  );
  await expect(page).toHaveURL(/skip=/);
});

test("kurzes Antippen oder kleines Ziehen ändert nichts", async ({ page }) => {
  await importDemo(page);
  await page.goto("/pruefen");
  await swipe(page.getByTestId("review-card"), 40);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("review-remaining")).toHaveText("noch 3");
});

test("„Passt“-Knopf macht dasselbe wie Wischen, ohne Geste", async ({ page }) => {
  await importDemo(page);
  await page.goto("/pruefen");
  await page.getByRole("button", { name: "Passt: Haushalt" }).click();
  await expect(page.getByRole("dialog", { name: "Gespeichert" })).toContainText("Haushalt");
});
