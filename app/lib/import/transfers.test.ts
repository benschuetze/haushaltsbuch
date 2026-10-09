import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { reapplyRules, setManualCategory } from "~/lib/categorize/apply";
import type { Db } from "~/lib/db/client";
import { accounts, categories, rules, transactions } from "~/lib/db/schema";
import { createTestDb } from "../../../tests/helpers/db";
import { importAuto } from "./run";

const paypalCsv = new Uint8Array(readFileSync("app/lib/import/profiles/__fixtures__/paypal.csv"));
// Bank side in the demo format: four PayPal debits that match top-ups, one that does not, one grocery run.
const bankCsv = new TextEncoder().encode(
  [
    "Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung",
    "04.09.2026;04.09.2026;PayPal Europe S.a.r.l. et Cie S.C.A;1AA11111AA1111111 PP.4471.PP Musikhaus Thomann;-89,00;EUR",
    "08.09.2026;08.09.2026;PayPal Europe S.a.r.l. et Cie S.C.A;3CC33333CC3333333 PP.4471.PP Zalando;-59,95;EUR",
    "13.09.2026;13.09.2026;PayPal Europe S.a.r.l. et Cie S.C.A;5EE55555EE5555555 PP.4471.PP Netflix;-13,99;EUR",
    "16.09.2026;16.09.2026;PayPal Europe S.a.r.l. et Cie S.C.A;0KK00000KK0000000 PP.4471.PP Steam;-18,42;EUR",
    "28.09.2026;28.09.2026;PayPal Europe S.a.r.l. et Cie S.C.A;PP.4471.PP Kauf ohne PayPal-Export;-42,00;EUR",
    "20.09.2026;20.09.2026;REWE Markt;Kartenzahlung;-31,20;EUR",
  ].join("\r\n"),
);

let db: Db;
let transferId: string;

beforeEach(async () => {
  ({ db } = await createTestDb());
  const [t] = await db.select().from(categories).where(eq(categories.name, "Umbuchung"));
  transferId = t?.id ?? "";
});

async function all() {
  return db
    .select({
      counterparty: transactions.counterparty,
      amountCents: transactions.amountCents,
      categoryId: transactions.categoryId,
      account: accounts.bankProfile,
    })
    .from(transactions)
    .innerJoin(accounts, eq(transactions.accountId, accounts.id));
}

/** What the overview counts as spending: everything negative that is not a transfer. */
async function spendingCents() {
  return (await all())
    .filter((t) => t.amountCents < 0 && t.categoryId !== transferId)
    .reduce((s, t) => s - t.amountCents, 0);
}

// Thomann 89 + Zalando 59,95 + Netflix 13,99 + Steam 18,42 + unmatched 42 + REWE 31,20
const ONCE = 8900 + 5995 + 1399 + 1842 + 4200 + 3120;

describe("PayPal und Girokonto zählen jede Ausgabe nur einmal", () => {
  it.each([
    ["erst Bank, dann PayPal", [bankCsv, paypalCsv]],
    ["erst PayPal, dann Bank", [paypalCsv, bankCsv]],
  ])("%s", async (_, files) => {
    for (const bytes of files) await importAuto(db, { filename: "x.csv", bytes, model: null });
    const rows = await all();

    const transfers = rows.filter((r) => r.categoryId === transferId);
    expect(transfers.filter((r) => r.account === "paypal")).toHaveLength(4);
    expect(
      transfers
        .filter((r) => r.account !== "paypal")
        .map((r) => r.amountCents)
        .sort((a, b) => a - b),
    ).toEqual([-8900, -5995, -1842, -1399]);
    // Without its PayPal row, the 42 € debit is the only trace of that purchase and stays spending.
    expect(rows.find((r) => r.amountCents === -4200)?.categoryId).not.toBe(transferId);
    expect(rows.find((r) => r.counterparty === "Musikhaus Thomann GmbH")?.categoryId).not.toBe(transferId);
    expect(await spendingCents()).toBe(ONCE);
  });

  it("eine breite Regel für „paypal“ macht die Umbuchungen nicht wieder zu Ausgaben", async () => {
    for (const bytes of [bankCsv, paypalCsv]) await importAuto(db, { filename: "x.csv", bytes, model: null });
    const [other] = await db.select().from(categories).where(eq(categories.name, "Sonstiges"));
    await db
      .insert(rules)
      .values({ field: "counterparty", matchType: "contains", pattern: "paypal", categoryId: other?.id ?? "" });
    await reapplyRules(db);
    expect(await spendingCents()).toBe(ONCE);
  });

  it("von Hand gesetzte Kategorie bleibt, auch wenn die Buchung zu einer Aufladung passt", async () => {
    await importAuto(db, { filename: "bank.csv", bytes: bankCsv, model: null });
    const [debit] = (await db.select().from(transactions)).filter((t) => t.amountCents === -8900);
    const [hobby] = await db.select().from(categories).where(eq(categories.name, "Hobbys"));
    await setManualCategory(db, debit?.id ?? "", hobby?.id ?? "");
    await importAuto(db, { filename: "paypal.csv", bytes: paypalCsv, model: null });
    const [after] = await db
      .select()
      .from(transactions)
      .where(eq(transactions.id, debit?.id ?? ""));
    expect(after).toMatchObject({ categoryId: hobby?.id, categorySource: "manual" });
  });
});

describe("Kreditkarte und Girokonto zählen jede Ausgabe nur einmal", () => {
  const amexCsv = new Uint8Array(readFileSync("app/lib/import/profiles/__fixtures__/amex.csv"));
  const giro = new TextEncoder().encode(
    [
      "Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung",
      "20.09.2026;20.09.2026;AMERICAN EXPRESS EUROPE S.A.;Lastschrift Kartenabrechnung;-367,49;EUR",
      "21.09.2026;21.09.2026;REWE Markt;Kartenzahlung;-31,20;EUR",
    ].join("\r\n"),
  );

  it.each([
    ["erst Karte, dann Bank", [amexCsv, giro]],
    ["erst Bank, dann Karte", [giro, amexCsv]],
  ])("%s: Kartenumsätze sind die Ausgaben, die Monatsabbuchung ist Umbuchung", async (_, files) => {
    for (const bytes of files) await importAuto(db, { filename: "x.csv", bytes, model: null });
    const rows = await all();
    expect(
      rows
        .filter((r) => r.categoryId === transferId)
        .map((r) => r.amountCents)
        .sort((a, b) => a - b),
    ).toEqual([-36749, 36749]);
    // Card purchases and the fee plus groceries; the 367,49 € settlement is not counted a second time.
    expect(await spendingCents()).toBe(1399 + 28900 + 6450 + 289 + 123456 + 3120);
  });
});
