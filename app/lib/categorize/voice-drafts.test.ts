import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { captureSpoken } from "~/lib/capture/run";
import type { Db } from "~/lib/db/client";
import { categories, rules, transactions } from "~/lib/db/schema";
import { decideReview } from "~/lib/review";
import { createTestDb } from "../../../tests/helpers/db";
import { scriptedModel } from "../../../tests/helpers/models";
import { categorizeOpen, reapplyRules, setManualCategory } from "./apply";

// A quick-capture sentence without an amount is a draft (0 EUR). Nothing may quietly take it out of "prüfen":
// booking it into a category does not make up for the missing amount.
let db: Db;
let cat: Record<string, string>;
let draftId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  cat = Object.fromEntries((await db.select().from(categories)).map((c) => [c.name, c.id]));
  const { transaction } = await captureSpoken(db, { text: "hab einen Döner gekauft", key: "draft" }, { model: null });
  draftId = transaction.id;
});

async function draft() {
  const [row] = await db.select().from(transactions).where(eq(transactions.id, draftId));
  if (!row) throw new Error("Entwurf fehlt");
  return row;
}

describe("Sprach-Entwurf ohne Betrag", () => {
  it("bleibt auf „prüfen“, wenn eine neue Regel passt (reapplyRules)", async () => {
    await db.insert(rules).values({
      field: "counterparty",
      matchType: "contains",
      pattern: "döner",
      categoryId: cat["Restaurant & Lieferdienst"] as string,
    });
    await reapplyRules(db);

    expect(await draft()).toMatchObject({
      categoryId: cat["Restaurant & Lieferdienst"],
      amountCents: 0,
      needsReview: true,
    });
  });

  it("geht bei categorizeOpen nie an das bezahlte Modell", async () => {
    const { model, calls } = scriptedModel(JSON.stringify({ results: [] }));
    const stats = await categorizeOpen(db, model);

    expect(calls).toHaveLength(0);
    expect(stats.needsReview).toBe(1);
    expect(await draft()).toMatchObject({ categoryId: null, needsReview: true });
  });

  it("bleibt auf „prüfen“, wenn die Kategorie von Hand gewählt wird (setManualCategory)", async () => {
    await setManualCategory(db, draftId, cat.Lebensmittel as string);
    expect(await draft()).toMatchObject({ categoryId: cat.Lebensmittel, categorySource: "manual", needsReview: true });
  });

  it("bleibt auf „prüfen“, wenn in /pruefen eine Kategorie gewählt wird (decideReview)", async () => {
    await decideReview(db, draftId, cat.Lebensmittel as string);
    expect((await draft()).needsReview).toBe(true);
  });
});
