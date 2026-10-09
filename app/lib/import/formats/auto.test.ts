import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import type { Db } from "~/lib/db/client";
import { accounts, bankFormats, transactions } from "~/lib/db/schema";
import { createTestDb } from "../../../../tests/helpers/db";
import { promptText, scriptedModel } from "../../../../tests/helpers/models";
import { importAuto } from "../run";
import { labelFromFilename } from "./detect";
import { readTable } from "./generic";
import { buildMappingPrompt, maskValue } from "./llm-mapping";

type Expected = {
  profile: string;
  learned?: "heuristic" | "ai";
  own_iban?: boolean;
  footer_lines?: number;
  rows_total: number;
  booked: number;
  pending: number;
  sum_cents: number;
};
const expected: Record<string, Expected> = JSON.parse(readFileSync("beispieldaten/banken/erwartet.json", "utf8"));
const read = (name: string) => new Uint8Array(readFileSync(`beispieldaten/banken/${name}`));
const unknown = Object.entries(expected).filter(([, e]) => e.profile === "auto");
const builtin = Object.entries(expected).filter(([name, e]) => name.endsWith(".csv") && e.profile !== "auto");

let db: Db;
beforeEach(async () => {
  ({ db } = await createTestDb());
});

describe.each(unknown)("unbekanntes Format %s", (name, e) => {
  it("wird beim ersten Upload gelernt, Konto wird angelegt, Summe stimmt", async () => {
    const result = await importAuto(db, {
      filename: name.split("/").pop() ?? name,
      bytes: read(name),
      model: createMockModel(),
    });
    expect(result.format.learned).toBe(e.learned);
    expect(result.account.created).toBe(true);
    expect(result).toMatchObject({ inserted: e.booked, duplicates: 0, rejected: [] });
    expect(result.skipped).toHaveLength(e.pending + (e.footer_lines ?? 0));
    expect(result.total).toBe(result.inserted + result.skipped.length);
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, result.account.id));
    expect(rows.reduce((s, r) => s + r.amountCents, 0)).toBe(e.sum_cents);
    expect(rows.every((r) => r.counterparty.length > 0)).toBe(true);
  });

  it("zweiter Upload derselben Bank: kein neues Format, kein Modellaufruf, nur Duplikate", async () => {
    await importAuto(db, { filename: name, bytes: read(name), model: createMockModel() });
    const { model, calls } = scriptedModel("{}");
    const second = await importAuto(db, { filename: name, bytes: read(name), model });
    expect(second.format.learned).toBeNull();
    expect(second.account.created).toBe(false);
    expect(second).toMatchObject({ inserted: 0, duplicates: e.booked });
    expect(calls).toHaveLength(0);
    expect(await db.$count(bankFormats)).toBe(1);
  });
});

describe("Spaltenzuordnung", () => {
  it("bekannte Spaltennamen kosten keinen Modellaufruf", async () => {
    const { model, calls } = scriptedModel("{}");
    const result = await importAuto(db, {
      filename: "n26-csv-transactions.csv",
      bytes: read("neu/n26-csv-transactions.csv"),
      model,
    });
    expect(result.format).toEqual({ label: "N26", learned: "heuristic" });
    // The model may still categorise the bookings; it must not be asked about the columns.
    expect(calls.map(promptText).some((p) => p.includes("Maskierte Beispielzeilen"))).toBe(false);
  });

  it("Soll/Haben: Soll wird negativ, Haben positiv", async () => {
    const result = await importAuto(db, {
      filename: "Kontoumsaetze_100_1234567_00_20261008.csv",
      bytes: read("neu/Kontoumsaetze_100_1234567_00_20261008.csv"),
      model: null,
    });
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, result.account.id));
    expect(rows.find((r) => r.counterparty === "Tierarztpraxis Pfote")?.amountCents).toBe(-8960);
    expect(rows.find((r) => r.purpose === "Rente 10/2026")?.amountCents).toBe(142000);
  });

  it("comdirect: Empfänger aus dem Buchungstext, ohne IBAN und ohne Referenz", async () => {
    const result = await importAuto(db, {
      filename: "umsaetze_1234567890_20261008-2114.csv",
      bytes: read("neu/umsaetze_1234567890_20261008-2114.csv"),
      model: null,
    });
    const rows = await db.select().from(transactions).where(eq(transactions.accountId, result.account.id));
    const thalia = rows.find((r) => r.amountCents === -3498);
    expect(thalia).toMatchObject({ counterparty: "Thalia Bücher", purpose: "Kartenzahlung" });
    expect(rows.find((r) => r.amountCents === 285000)?.counterparty).toBe("Arbeitgeber Beispiel AG");
  });

  it("ohne Modell und ohne erkennbare Spalten: verständlicher Fehler, nichts gespeichert", async () => {
    await expect(
      importAuto(db, { filename: "kontoflow-export.csv", bytes: read("neu/kontoflow-export.csv"), model: null }),
    ).rejects.toThrow(/kennt die App noch nicht.*Txn Dt, Ccy, Amt/);
    expect(await db.$count(transactions)).toBe(0);
    expect(await db.$count(bankFormats)).toBe(0);
  });

  it("eine falsche Zuordnung der KI wird verworfen, statt Unsinn zu importieren", async () => {
    // Claims the balance column is the date: no line parses, so the mapping must not be stored.
    const { model } = scriptedModel(
      JSON.stringify({
        bank: "X",
        date: 5,
        amount: 2,
        debit: null,
        credit: null,
        counterparty: 3,
        payer: null,
        payee: null,
        purpose: 4,
        currency: null,
        status: null,
      }),
    );
    await expect(
      importAuto(db, { filename: "kontoflow-export.csv", bytes: read("neu/kontoflow-export.csv"), model }),
    ).rejects.toThrow(/kennt die App noch nicht/);
    expect(await db.$count(bankFormats)).toBe(0);
  });

  it("an die KI gehen nur Spaltennamen und maskierte Muster, keine echten Werte", () => {
    const table = readTable(read("neu/kontoflow-export.csv"));
    if (!table) throw new Error("Tabelle nicht gefunden");
    const prompt = buildMappingPrompt(table);
    expect(prompt).toContain("Txn Dt");
    expect(prompt).not.toMatch(/Fitness|Flohmarkt|Stadtwerke|29\.90|2026-09-08/);
    expect(maskValue("REWE Markt -63,12")).toBe("AAAA Aaaaa -99,99");
  });

  it("der Prompt für die Spaltenzuordnung enthält keine Vorspann-Zeilen mit IBAN", async () => {
    const { model, calls } = scriptedModel("{}");
    // Deutsche Bank is recognised from its column names, so force the LLM path with a renamed header.
    const text = readFileSync("beispieldaten/banken/neu/Kontoumsaetze_100_1234567_00_20261008.csv", "latin1")
      .replace("Buchungstag;", "Tag;")
      .replace("Soll;Haben", "S;H");
    await importAuto(db, { filename: "x.csv", bytes: Buffer.from(text, "latin1"), model }).catch(() => undefined);
    expect(calls).toHaveLength(1);
    expect(promptText(calls[0] as (typeof calls)[number])).not.toMatch(/DE00|1007/);
  });
});

describe("Konten automatisch", () => {
  it.each(builtin)("%s: bekannte Bank, Konto mit den letzten vier IBAN-Stellen", async (name, e) => {
    const result = await importAuto(db, { filename: name, bytes: read(name), model: null });
    expect(result.format.learned).toBeNull();
    expect(result.inserted).toBe(e.booked);
    expect(result.account.created).toBe(true);
    expect(result.account.name).toMatch(/··[0-9A-Z]{4}$/);
  });

  it("ein von Hand angelegtes Konto derselben Bank wird übernommen statt doppelt angelegt", async () => {
    const [manual] = await db
      .insert(accounts)
      .values({ name: "Meine Sparkasse", bankProfile: "sparkasse" })
      .returning();
    const result = await importAuto(db, { filename: "sparkasse.csv", bytes: read("sparkasse.csv"), model: null });
    expect(result.account).toMatchObject({ id: manual?.id, name: "Meine Sparkasse", created: false });
  });

  it("zwei Konten derselben Bank mit verschiedener IBAN bleiben getrennt", async () => {
    const first = await importAuto(db, { filename: "sparkasse.csv", bytes: read("sparkasse.csv"), model: null });
    const other = readFileSync("beispieldaten/banken/sparkasse.csv", "latin1").replaceAll(
      "DE00100500000000123456",
      "DE00100500000000654321",
    );
    const second = await importAuto(db, {
      filename: "sparkasse.csv",
      bytes: Buffer.from(other, "latin1"),
      model: null,
    });
    expect(second.account.id).not.toBe(first.account.id);
    expect(second.account.name).toMatch(/··4321$/);
    expect(second.inserted).toBe(first.inserted);
  });

  it("Demo-Datei landet im vorhandenen Demo-Konto", async () => {
    const result = await importAuto(db, {
      filename: "demo.csv",
      bytes: new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv")),
      model: null,
    });
    expect(result.account).toMatchObject({ name: "Girokonto (Demo)", created: false });
  });
});

describe("labelFromFilename", () => {
  it.each([
    ["n26-csv-transactions.csv", "N26"],
    ["Kontoumsaetze_100_1234567_00_20261008.csv", "Neue Bank"],
    ["umsaetze_1234567890_20261008-2114.csv", "Neue Bank"],
    ["kontoflow-export.csv", "Kontoflow"],
  ])("%s → %s", (file, label) => {
    expect(labelFromFilename(file)).toBe(label);
  });
});
