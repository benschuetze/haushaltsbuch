import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "~/lib/db/client";
import { transactions } from "~/lib/db/schema";
import { createTestDb } from "../../../tests/helpers/db";
import { captureSpoken } from "./run";
import { undoCapture } from "./undo";

let db: Db;
const NOW = new Date("2026-10-21T10:00:00Z");
const minutesLater = (min: number) => new Date(NOW.getTime() + min * 60_000);

beforeEach(async () => {
  ({ db } = await createTestDb());
});

/** Books a sentence "now" and stamps created_at, because the column defaults to the database clock. */
async function book(text: string, key: string, createdAt = NOW) {
  const { transaction } = await captureSpoken(db, { text, key }, { model: null, now: createdAt });
  await db.update(transactions).set({ createdAt }).where(eq(transactions.id, transaction.id));
  return transaction.id;
}

const exists = async (id: string) => (await db.select().from(transactions).where(eq(transactions.id, id))).length > 0;

describe("undoCapture", () => {
  it("löscht eine frische Sprachbuchung", async () => {
    const id = await book("7 Euro Döner", "k1");
    expect(await undoCapture(db, id, minutesLater(9))).toEqual({ ok: true });
    expect(await exists(id)).toBe(false);
  });

  it("verweigert eine alte Sprachbuchung mit Betrag und lässt sie stehen", async () => {
    const id = await book("7 Euro Döner", "k1");
    const result = await undoCapture(db, id, minutesLater(11));
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("10 Minuten");
    expect(await exists(id)).toBe(true);
  });

  it("löscht einen alten Entwurf ohne Betrag, weil es keinen anderen Weg heraus gibt", async () => {
    const id = await book("irgendwas beim Bäcker", "k2");
    expect(await undoCapture(db, id, minutesLater(60 * 24))).toEqual({ ok: true });
    expect(await exists(id)).toBe(false);
  });

  it("fasst importierte Buchungen nie an, auch nicht mit Betrag 0 oder frisch", async () => {
    const id = await book("irgendwas beim Bäcker", "k3");
    // Same row, but as if it came from a bank file: 0 cents and young would qualify a voice row.
    await db.update(transactions).set({ source: "import" }).where(eq(transactions.id, id));
    const result = await undoCapture(db, id, NOW);
    expect(result.ok).toBe(false);
    expect(await exists(id)).toBe(true);
  });

  it("verweigert eine unbekannte Buchung", async () => {
    const result = await undoCapture(db, "00000000-0000-4000-8000-000000000000", NOW);
    expect(result.ok).toBe(false);
  });
});
