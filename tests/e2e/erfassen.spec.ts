import { expect, test } from "./fixtures";
import { DEMO_URL, expectNoHorizontalOverflow, expectNoSeriousA11yViolations, resetDb, sql } from "./helpers";

test.beforeEach(resetDb);

/** Chromium ships webkitSpeechRecognition, WebKit may not: each test states which world it runs in. */
async function withoutSpeech(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  });
}

test("ein Satz wird gebucht, Rückgängig nimmt die Buchung wieder heraus", async ({ page }) => {
  await withoutSpeech(page);
  await page.goto("/erfassen");
  await page.getByLabel("Was hast du bezahlt?").fill("7 Euro Döner");
  await page.getByRole("button", { name: "Buchen" }).click();

  const card = page.getByRole("status");
  await expect(card).toContainText("7,00 €");
  await expect(card).toContainText("Döner");
  await expect(card).toContainText("heute");
  await expect(page.getByLabel("Was hast du bezahlt?")).toHaveValue("");

  await page.goto("/buchungen");
  await expect(page.getByTestId("transaction").filter({ hasText: "Döner" })).toHaveCount(1);

  await page.goto("/erfassen");
  // The card is gone after the reload, so book again and undo straight away.
  await page.getByLabel("Was hast du bezahlt?").fill("7 Euro Eisdiele");
  await page.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status")).toContainText("Eisdiele");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.getByRole("status")).toContainText("Buchung entfernt");
  await expect(page.getByRole("button", { name: "Rückgängig" })).toHaveCount(0);

  await page.goto("/buchungen");
  await expect(page.getByTestId("transaction").filter({ hasText: "Eisdiele" })).toHaveCount(0);
  await expect(page.getByTestId("transaction").filter({ hasText: "Döner" })).toHaveCount(1);
});

test("ein Satz ohne Betrag wird als Entwurf gebucht und verweist auf „Prüfen“", async ({ page }) => {
  await withoutSpeech(page);
  await page.goto("/erfassen");
  await page.getByLabel("Was hast du bezahlt?").fill("hab einen Döner gekauft");
  await page.getByRole("button", { name: "Buchen" }).click();

  const card = page.getByRole("status");
  await expect(card).toContainText("Bitte prüfen");
  await expect(card).toContainText("Kein Betrag erkannt");
  await expect(card).toContainText("hab einen Döner gekauft");
  await card.getByRole("link", { name: "Bitte prüfen" }).click();
  await expect(page).toHaveURL(/\/pruefen$/);
  await expect(page.getByRole("heading", { level: 1, name: "Prüfen" })).toBeVisible();
});

test("ein älterer Entwurf ohne Betrag lässt sich noch zurücknehmen, eine ältere Buchung mit Betrag nicht", async ({
  page,
}) => {
  await withoutSpeech(page);
  await page.goto("/erfassen");
  await page.getByLabel("Was hast du bezahlt?").fill("irgendwas beim Bäcker");
  await page.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status")).toContainText("Kein Betrag erkannt");
  await sql("update transactions set created_at = now() - interval '2 days' where source = 'voice'");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.getByRole("status")).toContainText("Buchung entfernt");

  await page.getByLabel("Was hast du bezahlt?").fill("9 Euro Kino");
  await page.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status")).toContainText("Kino");
  await sql("update transactions set created_at = now() - interval '2 days' where source = 'voice'");
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(page.getByRole("alert")).toContainText("10 Minuten");
});

test("die Seite hat keine schweren Barrierefehler und läuft nicht über den Bildschirm", async ({ page }) => {
  await withoutSpeech(page);
  await page.goto("/erfassen");
  await expect(page.getByRole("heading", { level: 1, name: "Erfassen" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);

  await page.getByLabel("Was hast du bezahlt?").fill("7 Euro Döner");
  await page.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status")).toContainText("7,00 €");
  await expectNoHorizontalOverflow(page);
  await expectNoSeriousA11yViolations(page);
});

test("ohne Spracherkennung gibt es keinen Mikrofon-Knopf, dafür den Hinweis auf die Tastatur", async ({ page }) => {
  await withoutSpeech(page);
  await page.goto("/erfassen");
  await expect(page.getByRole("button", { name: "Diktieren" })).toHaveCount(0);
  await expect(page.getByText("Diktierfunktion der Tastatur nutzen")).toBeVisible();
});

test("der Datenschutzhinweis sagt, dass der Browser-Hersteller die Sprache erkennt", async ({ page }) => {
  await withoutSpeech(page);
  await page.goto("/erfassen");
  // Must match what /datenschutz says: Chrome and Safari send the audio to Google and Apple.
  await expect(
    page.getByText(
      "Die Spracherkennung übernimmt dein Browser bzw. dessen Hersteller (Google bei Chrome, Apple bei Safari). Die App bekommt kein Audio, nur den Text.",
    ),
  ).toBeVisible();
});

test("mit Spracherkennung füllt das Mikrofon das Textfeld, gebucht wird erst per „Buchen“", async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = "";
      interimResults = false;
      continuous = true;
      onresult: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      start() {
        (window as unknown as { __recognition: FakeRecognition }).__recognition = this;
        // Interim text first, the final sentence replaces it.
        const result = (transcript: string, isFinal: boolean) => ({
          resultIndex: 0,
          results: [Object.assign([{ transcript }], { isFinal })],
        });
        setTimeout(() => this.onresult?.(result("neun Euro", false)), 20);
        setTimeout(() => {
          this.onresult?.(result("neun Euro Kaffee", true));
          this.onend?.();
        }, 60);
      }
      stop() {
        this.onend?.();
      }
      abort() {}
    }
    Object.defineProperty(window, "SpeechRecognition", { value: FakeRecognition, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: FakeRecognition, configurable: true });
  });
  await page.goto("/erfassen");
  await expect(page.getByText("Diktierfunktion der Tastatur nutzen")).toHaveCount(0);
  await page.getByRole("button", { name: "Diktieren" }).click();
  await expect(page.getByLabel("Was hast du bezahlt?")).toHaveValue("neun Euro Kaffee");
  const lang = await page.evaluate(() => (window as unknown as { __recognition: { lang: string } }).__recognition.lang);
  expect(lang).toBe("de-DE");
  await expect(page.getByTestId("transaction")).toHaveCount(0);

  await page.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status")).toContainText("9,00 €");
});

/**
 * A recognizer the test drives by hand, like the real one it can deliver results at any moment, also after the
 * session ended. __say/__end call whatever handlers are set at that moment, as a browser would.
 */
async function manualSpeech(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    type Handlers = {
      onresult: ((e: unknown) => void) | null;
      onend: (() => void) | null;
      onerror: ((e: unknown) => void) | null;
    };
    class ManualRecognition implements Handlers {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult: Handlers["onresult"] = null;
      onend: Handlers["onend"] = null;
      onerror: Handlers["onerror"] = null;
      start() {
        (window as unknown as { __rec: ManualRecognition }).__rec = this;
      }
      stop() {}
      abort() {}
    }
    const w = window as unknown as Record<string, unknown>;
    w.__say = (transcript: string, isFinal: boolean) =>
      (w.__rec as Handlers).onresult?.({ results: [Object.assign([{ transcript }], { isFinal })] });
    w.__end = () => (w.__rec as Handlers).onend?.();
    w.__fail = (error: string) => (w.__rec as Handlers).onerror?.({ error });
    Object.defineProperty(window, "SpeechRecognition", { value: ManualRecognition, configurable: true });
    Object.defineProperty(window, "webkitSpeechRecognition", { value: ManualRecognition, configurable: true });
  });
}

const say = (page: import("@playwright/test").Page, text: string, final: boolean) =>
  page.evaluate(
    ([t, f]) => (window as unknown as { __say: (a: string, b: boolean) => void }).__say(t as string, f as boolean),
    [text, final],
  );

const fail = (page: import("@playwright/test").Page, code: string) =>
  page.evaluate((c) => (window as unknown as { __fail: (a: string) => void }).__fail(c), code);

test("ein spätes Ergebnis der Spracherkennung füllt das Feld nach dem Buchen nicht wieder, es wird nur einmal gebucht", async ({
  page,
}) => {
  await manualSpeech(page);
  await page.goto("/erfassen");
  const field = page.getByLabel("Was hast du bezahlt?");
  await page.getByRole("button", { name: "Diktieren" }).click();
  await say(page, "neun Euro", false);
  await expect(field).toHaveValue("neun Euro");
  // The session ended, but the recognizer still owes the final result.
  await page.evaluate(() => (window as unknown as { __end: () => void }).__end());
  await expect(page.getByRole("button", { name: "Diktieren" })).toBeVisible();

  await page.getByRole("button", { name: "Buchen" }).click();
  await expect(page.getByRole("status")).toContainText("9,00 €");
  await expect(field).toHaveValue("");
  await say(page, "neun Euro Kaffee", true);
  await expect(field).toHaveValue("");
  await expect(page.getByRole("button", { name: "Buchen" })).toBeDisabled();

  await page.goto("/buchungen");
  await expect(page.getByTestId("transaction")).toHaveCount(1);
});

test("während des Diktierens ist „Buchen“ gesperrt, auch per Eingabetaste", async ({ page }) => {
  await manualSpeech(page);
  await page.goto("/erfassen");
  const field = page.getByLabel("Was hast du bezahlt?");
  await page.getByRole("button", { name: "Diktieren" }).click();
  await say(page, "neun Euro Kaffee", false);
  await expect(field).toHaveValue("neun Euro Kaffee");
  await expect(page.getByRole("button", { name: "Buchen" })).toBeDisabled();
  await field.press("Enter");
  await expect(page.getByRole("status")).toBeEmpty();

  await page.getByRole("button", { name: "Diktat beenden" }).click();
  await page.evaluate(() => (window as unknown as { __end: () => void }).__end());
  await expect(page.getByRole("button", { name: "Buchen" })).toBeEnabled();
});

test("ein Spracherkennungs-Fehler nennt den Grund, ein selbst ausgelöster Abbruch bleibt still", async ({ page }) => {
  await manualSpeech(page);
  await page.goto("/erfassen");
  await page.getByRole("button", { name: "Diktieren" }).click();
  // Like a browser: the error is followed by the end of the session.
  await fail(page, "not-allowed");
  await page.evaluate(() => (window as unknown as { __end: () => void }).__end());
  await expect(page.getByRole("alert")).toContainText("Kein Zugriff aufs Mikrofon");

  await page.getByRole("button", { name: "Diktieren" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await fail(page, "aborted");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test.describe("Demo-Modus", () => {
  test.use({ storageState: { cookies: [], origins: [] }, baseURL: DEMO_URL });

  test("Erfassen ist schreibgeschützt und sagt es", async ({ page }) => {
    await withoutSpeech(page);
    await page.goto("/erfassen");
    await expect(page.getByText("Die Demo ist schreibgeschützt.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buchen" })).toBeDisabled();
  });
});

test("Erfassen steht in der Navigation", async ({ page, isMobile }) => {
  await page.goto("/");
  if (isMobile) {
    await page.getByRole("navigation", { name: "Schnellnavigation" }).getByText("Mehr").click();
    await page.getByRole("navigation", { name: "Schnellnavigation" }).getByRole("link", { name: "Erfassen" }).click();
  } else {
    await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "Erfassen" }).click();
  }
  await expect(page).toHaveURL(/\/erfassen$/);
});
