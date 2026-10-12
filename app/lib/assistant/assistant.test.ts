import { readFileSync } from "node:fs";
import { MockLanguageModelV4 } from "ai/test";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import type { Db } from "~/lib/db/client";
import { accounts, budgets, categories, imports, transactions } from "~/lib/db/schema";
import { importCsv } from "~/lib/import/run";
import { spendingToday } from "~/lib/insights";
import { formatCents } from "~/lib/money";
import { createTestDb } from "../../../tests/helpers/db";
import { failingModel } from "../../../tests/helpers/models";
import { askAssistant, chatSchema, dailyLimit } from "./agent.server";
import { createMockAssistantModel } from "./mock-model";

let db: Db;

beforeEach(async () => {
  ({ db } = await createTestDb());
  const [account] = await db.select().from(accounts);
  if (!account) throw new Error("Demo-Konto fehlt");
  await importCsv(db, {
    accountId: account.id,
    filename: "demo.csv",
    bytes: new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv")),
    model: createMockModel(),
  });
  // A gym filed under leisure, three months in a row: the classic forgotten subscription.
  const [leisure] = await db.select().from(categories).where(eq(categories.name, "Freizeit"));
  const [imp] = await db.select().from(imports);
  for (const d of ["2026-07-03", "2026-08-03", "2026-09-03"]) {
    await db.insert(transactions).values({
      accountId: account.id,
      importId: imp?.id ?? "",
      bookingDate: d,
      amountCents: -2990,
      counterparty: "Fitnessstudio Kraftwerk",
      purpose: "Mitgliedsbeitrag DE89370400440532013000",
      raw: {},
      dedupeHash: `gym-${d}`,
      categoryId: leisure?.id,
      categorySource: "rule",
    });
  }
});

const ask = (question: string, model = createMockAssistantModel()) =>
  askAssistant(db, model, [{ role: "user", content: question }]);

describe("Assistent", () => {
  it("findet versteckte Abos, auch wenn sie nicht als Abo einsortiert sind", async () => {
    const reply = await ask("Check mal, ob ich versteckte Abo-Kosten habe");
    expect(reply.tools).toEqual(["abos_und_fixkosten"]);
    expect(reply.answer).toContain("Fitnessstudio Kraftwerk");
    expect(reply.answer).toContain("Nicht als Abo einsortiert");
  });

  it("Monatsfragen: erst die Monate, dann die Übersicht des neuesten", async () => {
    const reply = await ask("Wie waren meine Ausgaben?");
    expect(reply.tools).toEqual(["monate", "monatsuebersicht"]);
    expect(reply.answer).toContain("Im 2026-09: Einnahmen 4.121,40 €");
  });

  it("Werkzeug-Ergebnisse gehen ohne IBAN an das Modell", async () => {
    const prompts: string[] = [];
    let step = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        prompts.push(JSON.stringify(prompt));
        step++;
        const usage = {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        };
        return step === 1
          ? {
              content: [
                {
                  type: "tool-call",
                  toolCallId: "c1",
                  toolName: "buchungen_suchen",
                  input: JSON.stringify({ suchbegriff: "Fitness" }),
                },
              ],
              finishReason: { unified: "tool-calls", raw: undefined },
              usage,
              warnings: [],
            }
          : {
              content: [{ type: "text", text: "ok" }],
              finishReason: { unified: "stop", raw: undefined },
              usage,
              warnings: [],
            };
      },
    });
    await ask("Zeig mir das Fitnessstudio", model);
    expect(prompts[1]).toContain("Fitnessstudio Kraftwerk");
    expect(prompts[1]).toContain("[IBAN]");
    expect(prompts[1]).not.toContain("DE89370400440532013000");
  });

  it("Tageslimit: danach freundliche Absage ohne Modellaufruf", async () => {
    const now = new Date("2026-10-09T10:00:00Z");
    let calls = 0;
    const counting = createMockAssistantModel();
    const original = counting.doGenerate.bind(counting);
    counting.doGenerate = async (o) => {
      calls++;
      return original(o);
    };
    for (let i = 0; i < dailyLimit(); i++)
      await askAssistant(db, counting, [{ role: "user", content: "Budget?" }], now);
    const before = calls;
    const reply = await askAssistant(db, counting, [{ role: "user", content: "Budget?" }], now);
    expect(reply.answer).toMatch(/Limit/);
    expect(calls).toBe(before);
  });

  it("Tageslimit pro Umgebung einstellbar, ungültige Werte fallen auf 60 zurück", () => {
    vi.stubEnv("ASSISTANT_DAILY_LIMIT", "25");
    expect(dailyLimit()).toBe(25);
    for (const bad of ["", "0", "-3", "abc", "2.5"]) {
      vi.stubEnv("ASSISTANT_DAILY_LIMIT", bad);
      expect(dailyLimit()).toBe(60);
    }
    vi.unstubAllEnvs();
  });

  it("abgeschnittene Antwort nach Werkzeugaufrufen: kurze Zusammenfassung statt „keine Antwort“", async () => {
    const usage = {
      inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 0, text: 0, reasoning: undefined },
    };
    const calls: { tools: boolean; prompt: string }[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt, tools }) => {
        calls.push({ tools: Boolean(tools?.length), prompt: JSON.stringify(prompt) });
        if (calls.length === 1)
          return {
            content: [
              { type: "reasoning", text: "erst Abos ansehen" },
              { type: "tool-call", toolCallId: "c1", toolName: "abos_und_fixkosten", input: "{}" },
            ],
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
            warnings: [],
          };
        if (calls.length === 2)
          // Budget used up by a tool call that never finished: no text at all.
          return { content: [], finishReason: { unified: "length", raw: undefined }, usage, warnings: [] };
        return {
          content: [{ type: "text", text: "Fang bei den Abos an." }],
          finishReason: { unified: "stop", raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
    const reply = await askAssistant(db, model, [{ role: "user", content: "Wo kann ich 100 € sparen?" }]);
    expect(reply.answer).toBe("Fang bei den Abos an.");
    expect(reply.tools).toEqual(["abos_und_fixkosten"]);
    // The summary sees what the tools returned, and may not call any more.
    expect(calls[2]?.tools).toBe(false);
    expect(calls[2]?.prompt).toContain("abos_und_fixkosten");
    // Thinking blocks are signed for the original request; the API rejects them when sent again.
    expect(calls[2]?.prompt).not.toContain("erst Abos ansehen");
  });

  it("API-Fehler: verständliche Antwort statt Absturz", async () => {
    const reply = await ask("Budget?", failingModel());
    expect(reply.answer).toBe("Gerade kann ich nicht antworten. Bitte später noch einmal versuchen.");
  });

  it("Verlauf wird geprüft: Länge, Größe, letzte Nachricht ist eine Frage", () => {
    expect(chatSchema.safeParse([{ role: "assistant", content: "hi" }]).success).toBe(false);
    expect(chatSchema.safeParse([{ role: "user", content: "x".repeat(1001) }]).success).toBe(false);
    expect(chatSchema.safeParse(Array.from({ length: 11 }, () => ({ role: "user", content: "a" }))).success).toBe(
      false,
    );
    expect(chatSchema.safeParse([{ role: "user", content: "Wie viel für Essen?" }]).success).toBe(true);
  });
});

describe("Frag einfach: Geld für heute", () => {
  const september10 = new Date("2026-09-10T10:00:00Z");
  const askOn = (question: string) =>
    askAssistant(db, createMockAssistantModel(), [{ role: "user", content: question }], september10);

  it("„Wie viel kann ich heute ausgeben?“ nennt den Tagesbetrag aus der Rechnung, bis zum nächsten Gehalt", async () => {
    const reply = await askOn("Wie viel kann ich heute ausgeben?");
    expect(reply.tools).toEqual(["heute_verfuegbar"]);
    const a = await spendingToday(db, september10);
    expect(reply.answer).toContain(`Dein Tagesbudget heute: ${formatCents(a.perDayCents)}.`);
    expect(reply.answer).toContain("Bis zum Gehalt am 1. Oktober");
  });

  it("„Kann ich mir 80 € fürs Feiern leisten?“ prüft den Betrag und antwortet mit Urteil", async () => {
    const reply = await askOn("Kann ich mir 80 € fürs Feiern leisten?");
    expect(reply.tools).toEqual(["leisten"]);
    expect(reply.answer).toMatch(/^(Ja, locker|Ja, geht|Knapp|Eher nicht)\./);
  });

  it("„leisten“ nennt ein schon überschrittenes Budget der passenden Kategorie, das Urteil bleibt", async () => {
    const [leisure] = await db.select().from(categories).where(eq(categories.name, "Freizeit"));
    if (!leisure) throw new Error("Freizeit fehlt");
    await db.delete(budgets).where(eq(budgets.categoryId, leisure.id));
    // The gym (29,90 € on 3 September) alone is over this.
    await db.insert(budgets).values({ categoryId: leisure.id, amountCents: 2000 });
    const reply = await askOn("Kann ich mir 80 € fürs Feiern leisten?");
    expect(reply.answer).toMatch(/^(Ja, locker|Ja, geht|Knapp|Eher nicht)\./);
    expect(reply.answer).toContain("Dein Budget für Freizeit ist diesen Monat schon überschritten");
  });

  it("ohne Budget für die Kategorie bleibt die Antwort beim Tagesbudget", async () => {
    const [leisure] = await db.select().from(categories).where(eq(categories.name, "Freizeit"));
    await db.delete(budgets).where(eq(budgets.categoryId, leisure?.id ?? ""));
    const reply = await askOn("Kann ich mir 80 € fürs Feiern leisten?");
    expect(reply.answer).not.toContain("Budget für");
  });

  it("„Wann kommt mein Gehalt?“ nennt Datum und Betrag", async () => {
    const reply = await askOn("Wann kommt mein Gehalt?");
    expect(reply.tools).toEqual(["naechste_zahlungen"]);
    expect(reply.answer).toContain("Das nächste Gehalt (3.612,40 €) kommt am 1. Oktober.");
  });
});

describe("Frag einfach: größere Wünsche und Sparziele", () => {
  const september10 = new Date("2026-09-10T10:00:00Z");
  const askOn = (question: string) =>
    askAssistant(db, createMockAssistantModel(), [{ role: "user", content: question }], september10);

  it("„Wann kann ich mir 5000 € leisten?“ nennt einen Monat", async () => {
    const reply = await askOn("Wann kann ich mir 5000 € für ein Auto leisten?");
    expect(reply.tools).toEqual(["wann_leisten"]);
    expect(reply.answer).toMatch(/^(Im \w+ \d{4}\.|Das geht schon jetzt|Gerade bleibt)/);
  });

  it("ohne Sparziele: freundlicher Hinweis, wo man eins anlegt", async () => {
    const reply = await askOn("Wie stehen meine Sparziele?");
    expect(reply.tools).toEqual(["sparziele"]);
    expect(reply.answer).toContain("noch kein Sparziel");
  });
});

describe("Frag einfach: die Woche", () => {
  it("„Wie lief meine Woche?“ nutzt den Wochenvergleich, „Was geht diese Woche noch ab?“ weiter die Zahlungen", async () => {
    const on = new Date("2026-09-24T10:00:00Z");
    const week = await askAssistant(
      db,
      createMockAssistantModel(),
      [{ role: "user", content: "Wie lief meine Woche?" }],
      on,
    );
    expect(week.tools).toEqual(["woche"]);
    expect(week.answer).toMatch(/^Seit Montag .* ausgegeben/);
    const due = await askAssistant(
      db,
      createMockAssistantModel(),
      [{ role: "user", content: "Was geht diese Woche noch ab?" }],
      on,
    );
    expect(due.tools).toEqual(["naechste_zahlungen"]);
  });
});

describe("Ton", () => {
  it("frech: gleiche Fakten, mit Spruch davor; freundlich: ohne", async () => {
    const on = new Date("2026-09-10T10:00:00Z");
    const q = [{ role: "user" as const, content: "Kann ich mir 80 € fürs Feiern leisten?" }];
    const nice = await askAssistant(db, createMockAssistantModel(), q, on, "freundlich");
    const cheeky = await askAssistant(db, createMockAssistantModel(), q, on, "frech");
    expect(cheeky.answer).toMatch(/^(Gönn dir\.|Autsch\.|Hm, mutig\.) /);
    expect(cheeky.answer.endsWith(nice.answer)).toBe(true);
  });
});
