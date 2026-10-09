import { expect, test } from "./fixtures";
import { importDemo, resetDb } from "./helpers";

test.beforeEach(resetDb);

test("als App installierbar: Manifest mit Name, Startseite und Icons, die es wirklich gibt", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Haushaltsbuch", start_url: "/", display: "standalone", lang: "de" });
  for (const icon of [...manifest.icons, { src: "/icons/apple-touch-icon.png" }]) {
    const r = await request.get(icon.src);
    expect(r.ok(), icon.src).toBe(true);
    expect(r.headers()["content-type"]).toBe("image/png");
  }
});

test("Kurzbefehl „Frag einfach“ (?fragen=1) springt direkt ins Fragefeld", async ({ page }) => {
  await importDemo(page);
  await page.goto("/?fragen=1");
  await expect(page.getByLabel("Frage an dein Haushaltsbuch")).toBeFocused();
});

test("Frage sprechen: erkannter Text steht im Feld und wird beantwortet", async ({ page }) => {
  // Stands in for the browser's speech recognition: "hears" one sentence, then stops.
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = "";
      interimResults = false;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        setTimeout(() => {
          const result = Object.assign([{ transcript: "Wie viel kann ich heute ausgeben" }], { isFinal: true });
          this.onresult?.({ results: [result] });
          this.onend?.();
        }, 50);
      }
      stop() {
        this.onend?.();
      }
    }
    // Newer Chrome has the unprefixed name as well; replace both.
    Object.assign(window, { SpeechRecognition: FakeRecognition, webkitSpeechRecognition: FakeRecognition });
  });
  await importDemo(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Frage sprechen" }).click();
  await expect(page.getByTestId("ask-turns")).toContainText("Wie viel kann ich heute ausgeben");
  await expect(page.getByTestId("ask-answer")).toContainText("drin");
});
