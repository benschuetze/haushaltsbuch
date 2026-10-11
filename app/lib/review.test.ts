import { readFileSync } from "node:fs";
import { desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "~/lib/db/client";
import { accounts, categories, rules, transactions } from "~/lib/db/schema";
import { importCsv } from "~/lib/import/run";
import { createTestDb } from "../../tests/helpers/db";
import { scriptedModel } from "../../tests/helpers/models";
import { decideReview, nextReview } from "./review";

let db: Db;
let cat: Record<string, string>;

/** Every booking comes back unsure, so everything lands in review. */
function unsureModel() {
  return scriptedModel((call) => {
    const refs = [...JSON.stringify(call.prompt).matchAll(/\\"ref\\":\\"(t\d+)\\"/g)].map((m) => m[1]);
    return JSON.stringify({ results: refs.map((ref) => ({ ref, category: "Sonstiges", confidence: 0.3 })) });
  }).model;
}

beforeEach(async () => {
  ({ db } = await createTestDb());
  const [account] = await db.select().from(accounts);
  if (!account) throw new Error("Demo-Konto fehlt");
  await importCsv(db, {
    accountId: account.id,
    filename: "demo.csv",
    bytes: new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv")),
    model: unsureModel(),
  });
  cat = Object.fromEntries((await db.select().from(categories)).map((c) => [c.name, c.id]));
});

describe("Prüfen", () => {
  it("die Wahl gilt dauerhaft: Regel entsteht, alle Buchungen des Empfängers sind erledigt", async () => {
    // A merchant the built-in list does not know, so it is still open for review.
    const [kita] = await db.select().from(transactions).where(eq(transactions.counterparty, "Kita Regenbogen e.V."));
    if (!kita) throw new Error("Kita fehlt");
    const decision = await decideReview(db, kita.id, cat["Kind & Kita"] as string);
    expect(decision).toEqual({
      counterparty: "Kita Regenbogen e.V.",
      categoryName: "Kind & Kita",
      permanent: true,
      alsoChanged: 1,
    });
    const all = await db.select().from(transactions).where(eq(transactions.counterparty, "Kita Regenbogen e.V."));
    expect(all.every((t) => t.categoryId === cat["Kind & Kita"] && !t.needsReview)).toBe(true);
    expect(await db.select({ note: rules.note }).from(rules)).toEqual([{ note: "Beim Prüfen festgelegt" }]);
  });

  it("bei PayPal nur diese eine Buchung, keine Regel für alle PayPal-Zahlungen", async () => {
    const [paypal] = await db.select().from(transactions).where(eq(transactions.counterparty, "PayPal Europe"));
    if (!paypal) throw new Error("PayPal fehlt");
    const decision = await decideReview(db, paypal.id, cat.Kleidung as string);
    expect(decision).toMatchObject({ permanent: false, alsoChanged: 0 });
    expect(await db.$count(rules)).toBe(0);
    expect(await db.$count(transactions, eq(transactions.counterparty, "PayPal Europe"))).toBe(3);
  });

  it("zweite Wahl für denselben Empfänger ändert die bestehende Regel statt eine zweite anzulegen", async () => {
    const [first, second] = await db.select().from(transactions).where(eq(transactions.counterparty, "Spotify AB"));
    if (!first || !second) throw new Error("Spotify fehlt");
    await decideReview(db, first.id, cat.Freizeit as string);
    await db
      .update(transactions)
      .set({ needsReview: true, categorySource: null })
      .where(eq(transactions.id, second.id));
    await decideReview(db, second.id, cat["Abos & Software"] as string);
    const all = await db.select().from(rules);
    expect(all).toHaveLength(1);
    expect(all[0]?.categoryId).toBe(cat["Abos & Software"]);
  });

  it("nextReview liefert die neueste offene Buchung, Übersprungene nicht", async () => {
    const { tx, remaining } = await nextReview(db, []);
    // Everything the built-in merchant list does not know waits for review.
    expect(remaining).toBe(await db.$count(transactions, eq(transactions.needsReview, true)));
    expect(remaining).toBeGreaterThan(0);
    const newest = await db
      .select({ d: transactions.bookingDate })
      .from(transactions)
      .where(eq(transactions.needsReview, true))
      .orderBy(desc(transactions.bookingDate))
      .limit(1);
    expect(tx?.bookingDate).toBe(newest[0]?.d);
    const after = await nextReview(db, [tx?.id ?? ""]);
    expect(after.tx?.id).not.toBe(tx?.id);
  });
});
