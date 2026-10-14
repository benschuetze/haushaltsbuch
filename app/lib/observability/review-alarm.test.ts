import { readFileSync } from "node:fs";
import type { LanguageModel } from "ai";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "~/lib/db/client";
import { accounts, transactions } from "~/lib/db/schema";
import { importCsv } from "~/lib/import/run";
import { createTestDb } from "../../../tests/helpers/db";
import { failingModel, scriptedModel } from "../../../tests/helpers/models";
import { REVIEW_ALARM, reviewShare } from "./review-alarm";

let db: Db;

async function importDemo(model: LanguageModel) {
  const [account] = await db.select().from(accounts);
  if (!account) throw new Error("Demo-Konto fehlt");
  await importCsv(db, {
    accountId: account.id,
    filename: "demo.csv",
    bytes: new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv")),
    model,
  });
}

/** Sure about every booking, like a healthy model on easy data. */
const confidentModel = () =>
  scriptedModel((call) => {
    const refs = [...JSON.stringify(call.prompt).matchAll(/\\"ref\\":\\"(t\d+)\\"/g)].map((m) => m[1]);
    return JSON.stringify({ results: refs.map((ref) => ({ ref, category: "Sonstiges", confidence: 0.95 })) });
  }).model;

beforeEach(async () => {
  ({ db } = await createTestDb());
});

describe("Alarm: Anteil „prüfen“", () => {
  it("schlägt an, wenn das Modell ausfällt und alles in „prüfen“ landet", async () => {
    await importDemo(failingModel());
    const r = await reviewShare(db);
    expect(r.total).toBeGreaterThanOrEqual(REVIEW_ALARM.minBookings);
    expect(r.share).toBeGreaterThan(REVIEW_ALARM.share);
    expect(r.alarm).toBe(true);
  });

  it("bleibt still, wenn das Modell nur einzelne Buchungen offen lässt", async () => {
    await importDemo(confidentModel());
    // Like a normal week: the model is unsure about a couple of bookings.
    await db.execute(
      sql`update transactions set needs_review = true
          where id in (select id from transactions where category_source = 'ai' order by id limit 2)`,
    );
    const r = await reviewShare(db);
    expect(r.open).toBe(2);
    expect(r.alarm).toBe(false);
  });

  it("zählt nur, was beim Modell lag: von Regeln erledigte Buchungen verwässern den Anteil nicht", async () => {
    await importDemo(failingModel());
    const all = await db.select().from(transactions);
    const r = await reviewShare(db);
    expect(r.total).toBeLessThan(all.length);
    expect(r.share).toBe(1);
  });

  it("bleibt still, wenn das Modell sicher zuordnet", async () => {
    await importDemo(confidentModel());
    const r = await reviewShare(db);
    expect(r.total).toBeGreaterThanOrEqual(REVIEW_ALARM.minBookings);
    expect(r.alarm).toBe(false);
  });

  it("zählt nur die letzten 7 Tage: ein alter Rückstand löst keinen Alarm aus", async () => {
    await importDemo(failingModel());
    await db.update(transactions).set({ createdAt: sql`now() - interval '8 days'` });
    expect(await reviewShare(db)).toMatchObject({ total: 0, alarm: false });
  });

  it("bleibt bei wenigen neuen Buchungen still, auch wenn alle offen sind", async () => {
    await importDemo(failingModel());
    const keep = REVIEW_ALARM.minBookings - 1;
    await db.execute(
      sql`update transactions set created_at = now() - interval '8 days'
          where id not in (select id from transactions where category_source is null order by id limit ${keep})`,
    );
    const r = await reviewShare(db);
    expect(r.total).toBe(keep);
    expect(r.alarm).toBe(false);
  });
});
