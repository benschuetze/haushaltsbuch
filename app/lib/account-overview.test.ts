import { describe, expect, it } from "vitest";
import { createTestDb } from "../../tests/helpers/db";
import { accountOverview } from "./account-overview.server";
import { accounts } from "./db/schema";

describe("Kontenübersicht", () => {
  it("kommt mit allen Kontoarten zurecht: Import, Bankanbindung, Mock, unbekannt", async () => {
    const { db } = await createTestDb({ seeded: false });
    await db.insert(accounts).values([
      { name: "Giro", bankProfile: "sparkasse", accountKey: "a" },
      { name: "DKB Live", bankProfile: "bank:DKB", accountKey: "b" },
      { name: "PayPal (Mock)", bankProfile: "mock", accountKey: "mock:paypal" },
      { name: "Alt", bankProfile: "gibt-es-nicht", accountKey: "c" },
    ]);
    const labels = Object.fromEntries((await accountOverview(db)).map((a) => [a.name, a.bank]));
    expect(labels).toEqual({
      Giro: "Sparkasse (CSV-CAMT V2)",
      "DKB Live": "DKB (Bankanbindung)",
      "PayPal (Mock)": "Mockdaten",
      Alt: "Unbekannte Bank",
    });
  });
});
