import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import { accounts } from "~/lib/db/schema";
import { importCsv } from "~/lib/import/run";
import expected from "../../beispieldaten/erwartet.json";
import { createTestDb } from "../../tests/helpers/db";
import { monthRange, monthSummary, monthsWithData, previousMonth } from "./queries";

describe("Monatsübersicht", () => {
  it.each(Object.entries(expected.months))(
    "%s: Einnahmen und Ausgaben stimmen mit erwartet.json, Umbuchungen herausgerechnet",
    async (month, m) => {
      const { db } = await createTestDb();
      const [account] = await db.select().from(accounts);
      if (!account) throw new Error("Demo-Konto fehlt");
      await importCsv(db, {
        accountId: account.id,
        filename: "demo.csv",
        bytes: new Uint8Array(readFileSync("beispieldaten/demo-umsaetze.csv")),
        model: createMockModel(),
      });
      const summary = await monthSummary(db, month);
      expect(summary.transactionCount).toBe(m.rows);
      expect(summary.incomeCents).toBe(m.income_cents);
      expect(summary.transferCents).toBe(m.transfer_cents);
      expect(summary.expenseCents).toBe(m.expense_cents - m.transfer_cents);
      expect(summary.byCategory.reduce((s, c) => s + c.cents, 0)).toBe(m.income_cents + m.expense_cents);
      expect(await monthsWithData(db)).toEqual(["2026-09", "2026-08"]);
    },
  );

  it("leerer Monat liefert Nullen statt eines Fehlers", async () => {
    const { db } = await createTestDb();
    expect(await monthSummary(db, "2026-01")).toMatchObject({
      incomeCents: 0,
      expenseCents: 0,
      transactionCount: 0,
      byCategory: [],
    });
  });
});

describe("Monatsrechnung", () => {
  it("monthRange über den Jahreswechsel", () => {
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2027-01-01" });
  });
  it("previousMonth über den Jahreswechsel", () => {
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-10")).toBe("2026-09");
  });
});
