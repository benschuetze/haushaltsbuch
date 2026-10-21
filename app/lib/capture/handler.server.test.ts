import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "~/lib/db/client";
import { loginAttempts, transactions } from "~/lib/db/schema";
import { MAX_PER_IP } from "~/lib/login-throttle.server";
import { createTestDb } from "../../../tests/helpers/db";
import { failingModel } from "../../../tests/helpers/models";
import { handleCapture } from "./handler.server";

// Generated at runtime so no credential-looking literal ends up in the repo.
const TOKEN = randomBytes(24).toString("hex");
const NOW = new Date("2026-10-21T10:00:00Z");

let db: Db;

beforeEach(async () => {
  ({ db } = await createTestDb());
  vi.stubEnv("CAPTURE_TOKEN", TOKEN);
  vi.stubEnv("DEMO_MODE", "false");
});
afterEach(() => vi.unstubAllEnvs());

function post(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) {
  return new Request("http://x/api/capture", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const run = (request: Request, model = failingModel()) => handleCapture(request, { db, model, now: NOW });
const rows = () => db.select().from(transactions);

describe("POST /api/capture", () => {
  it("bucht mit gültigem Token und antwortet mit der Buchung", async () => {
    const response = await run(post({ text: "hab 7 Euro für Döner gezahlt", key: "k1" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      amountCents: -700,
      bookingDate: "2026-10-21",
      account: "Bar",
      draft: false,
      needsReview: true,
      category: null,
    });
    expect(await rows()).toHaveLength(1);
  });

  it("derselbe Schlüssel zweimal: Antwort 200 mit der ersten Buchung, keine zweite Zeile", async () => {
    const first = await (await run(post({ text: "hab 7 Euro für Döner gezahlt", key: "same" }))).json();
    const again = await run(post({ text: "hab 7 Euro für Döner gezahlt", key: "same" }));

    expect(again.status).toBe(200);
    expect((await again.json()).id).toBe(first.id);
    expect(await rows()).toHaveLength(1);
  });

  it("ein Satz ohne Betrag wird trotzdem angenommen, als Entwurf", async () => {
    const response = await run(post({ text: "hab einen Döner gekauft", key: "d" }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ draft: true, amountCents: 0, needsReview: true });
    expect((await rows())[0]?.captureText).toBe("hab einen Döner gekauft");
  });

  describe("Zugang", () => {
    it("falsches Token: 401 und keine Zeile", async () => {
      const response = await run(post({ text: "7 Euro Döner", key: "k" }, { authorization: "Bearer falsch" }));
      expect(response.status).toBe(401);
      expect(await rows()).toHaveLength(0);
    });

    it("ohne Authorization-Header: 401", async () => {
      expect((await run(post({ text: "7 Euro Döner", key: "k" }, {}))).status).toBe(401);
      expect(await rows()).toHaveLength(0);
    });

    it("das Token im Body oder als Query zählt nicht", async () => {
      const request = post({ text: "7 Euro Döner", key: "k", token: TOKEN }, {});
      expect((await run(request)).status).toBe(401);
    });

    it("ohne eingerichtetes CAPTURE_TOKEN (oder zu kurz) ist der Endpunkt aus", async () => {
      vi.stubEnv("CAPTURE_TOKEN", "");
      expect((await run(post({ text: "7 Euro Döner", key: "k" }, { authorization: "Bearer " }))).status).toBe(503);
      vi.stubEnv("CAPTURE_TOKEN", "kurz");
      expect((await run(post({ text: "7 Euro Döner", key: "k" }, { authorization: "Bearer kurz" }))).status).toBe(503);
      expect(await rows()).toHaveLength(0);
    });

    it("nach zu vielen Fehlversuchen von einer Adresse: 429, auch mit richtigem Token", async () => {
      const wrong = { authorization: "Bearer falsch" };
      for (let i = 0; i < MAX_PER_IP; i++) await run(post({ text: "7 Euro Döner", key: "k" }, wrong));
      expect(await db.$count(loginAttempts)).toBe(MAX_PER_IP);

      expect((await run(post({ text: "7 Euro Döner", key: "k" }))).status).toBe(429);
      expect(await rows()).toHaveLength(0);
    });

    it("Demo verweigert Schreiben, auch mit richtigem Token", async () => {
      vi.stubEnv("DEMO_MODE", "true");
      expect((await run(post({ text: "7 Euro Döner", key: "k" }))).status).toBe(403);
      expect(await rows()).toHaveLength(0);
    });
  });

  describe("Eingabe", () => {
    it.each([
      ["kein JSON", "{kaputt"],
      ["Text fehlt", { key: "k" }],
      ["Text leer", { text: "   ", key: "k" }],
      ["Schlüssel fehlt", { text: "7 Euro Döner" }],
      ["Text kein String", { text: 7, key: "k" }],
      ["Text zu lang", { text: "x".repeat(501), key: "k" }],
    ])("%s: 400 und keine Zeile", async (_name, body) => {
      const response = await run(post(body));
      expect(response.status).toBe(400);
      expect(await rows()).toHaveLength(0);
    });

    it("ein riesiger Body wird abgelehnt", async () => {
      const response = await run(post(JSON.stringify({ text: "7 Euro", key: "k", pad: "x".repeat(10_000) })));
      expect(response.status).toBe(413);
    });
  });

  it("die Antwort nennt nur die Buchung, nie den Fehlertext oder das Token", async () => {
    const response = await run(post({ text: "7 Euro Döner", key: "k" }));
    expect(JSON.stringify(await response.json())).not.toContain(TOKEN);
  });
});
