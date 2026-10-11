import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "~/lib/db/client";
import { accounts, transactions } from "~/lib/db/schema";
import { openInsights } from "~/lib/insights";
import { createTestDb } from "../../../tests/helpers/db";
import { connectMock, listMockAccounts, removeMock } from "./mock.server";
import { mockBookings } from "./mock-data";

let db: Db;
const now = new Date("2026-10-15T12:00:00Z");
beforeEach(async () => {
  ({ db } = await createTestDb());
});

describe("Mockdaten", () => {
  it("gleiche Bank, gleicher Tag: gleiche Buchungen; nichts liegt in der Zukunft", () => {
    const a = mockBookings("paypal", "2026-10-15");
    expect(a).toEqual(mockBookings("paypal", "2026-10-15"));
    expect(a.every((b) => b.bookingDate <= "2026-10-15" && b.amountCents < 0)).toBe(true);
    expect(a.filter((b) => b.counterparty === "Netflix")).toHaveLength(3);
  });

  it("verbinden legt ein gekennzeichnetes Konto mit Buchungen an, Abos werden erkannt, Unklares landet in „prüfen“", async () => {
    const result = await connectMock(db, { id: "paypal", name: "PayPal" }, now);
    expect(result).toMatchObject({ accountName: "PayPal (Mock)", existed: false });
    const [account] = await db.select().from(accounts).where(eq(accounts.name, "PayPal (Mock)"));
    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.accountId, account?.id ?? ""));
    expect(rows).toHaveLength(result.inserted);
    expect(rows.some((r) => r.needsReview)).toBe(true);
    const abos = (await openInsights(db, 100)).find((i) => i.kind === "subscription_found");
    expect(abos?.body).toContain("Netflix");
  });

  it("zweimal verbinden legt nichts doppelt an", async () => {
    await connectMock(db, { id: "dkb", name: "DKB" }, now);
    const again = await connectMock(db, { id: "dkb", name: "DKB" }, now);
    expect(again).toMatchObject({ existed: true, inserted: 0 });
    expect(await listMockAccounts(db)).toHaveLength(1);
  });

  it("entfernen nimmt Konto, Buchungen und Hinweise mit, echte Konten sind tabu", async () => {
    await connectMock(db, { id: "paypal", name: "PayPal" }, now);
    const [mock] = await listMockAccounts(db);
    const [real] = await db.select().from(accounts).where(eq(accounts.name, "Girokonto (Demo)"));
    expect(await removeMock(db, real?.id ?? "", now)).toBeNull();
    expect(await removeMock(db, mock?.id ?? "", now)).toBe("PayPal (Mock)");
    expect(await listMockAccounts(db)).toEqual([]);
    expect(await db.$count(transactions)).toBe(0);
    expect(await openInsights(db, 100)).toEqual([]);
    expect(await db.$count(accounts, eq(accounts.name, "Girokonto (Demo)"))).toBe(1);
  });
});
