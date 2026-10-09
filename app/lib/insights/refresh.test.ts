import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createMockModel } from "~/lib/categorize/mock-model";
import type { Db } from "~/lib/db/client";
import { accounts, budgets, categories, insights } from "~/lib/db/schema";
import { DEFAULT_BUDGETS, seed } from "~/lib/db/seed";
import { importCsv } from "~/lib/import/run";
import { listCancellations, markCancelled, undoCancellation } from "~/lib/subscriptions";
import { createTestDb } from "../../../tests/helpers/db";
import { budgetStatus, dismissInsight, notificationSummary, openInsights, refreshInsights } from "./index";

let db: Db;
let foodId: string;
const october = new Date("2026-10-09T12:00:00Z");

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
  const [food] = await db.select().from(categories).where(eq(categories.name, "Lebensmittel"));
  foodId = food?.id ?? "";
});

describe("Standardbudgets", () => {
  it("werden einmal angelegt und kommen nach dem Löschen nicht zurück", async () => {
    expect(await db.$count(budgets)).toBe(Object.keys(DEFAULT_BUDGETS).length);
    await db.delete(budgets).where(eq(budgets.categoryId, foodId));
    await seed(db);
    expect(await db.$count(budgets, eq(budgets.categoryId, foodId))).toBe(0);
  });
});

describe("refreshInsights", () => {
  it("Budget gerissen: Hinweis erscheint, Wegklicken hält, nicht mehr zutreffend verschwindet er", async () => {
    await db.update(budgets).set({ amountCents: 10000 }).where(eq(budgets.categoryId, foodId));
    await refreshInsights(db, october);
    const exceeded = (await openInsights(db)).filter((i) => i.title === "Budget Lebensmittel überschritten");
    expect(exceeded).toHaveLength(1);
    // September is the reference: October has no bookings yet in the demo data.
    expect(exceeded[0]?.month).toBe("2026-09");
    expect((await notificationSummary(db)).unreadInsights).toBeGreaterThan(0);

    await dismissInsight(db, exceeded[0]?.id ?? "");
    await refreshInsights(db, october);
    expect((await openInsights(db)).some((i) => i.title === "Budget Lebensmittel überschritten")).toBe(false);
    expect(await db.$count(insights, eq(insights.title, "Budget Lebensmittel überschritten"))).toBe(1);
  });

  it("nicht weggeklickte Hinweise verschwinden, wenn sie nicht mehr gelten", async () => {
    await db.update(budgets).set({ amountCents: 10000 }).where(eq(budgets.categoryId, foodId));
    await refreshInsights(db, october);
    await db.update(budgets).set({ amountCents: 100000 }).where(eq(budgets.categoryId, foodId));
    await refreshInsights(db, october);
    expect(await db.$count(insights, eq(insights.title, "Budget Lebensmittel überschritten"))).toBe(0);
  });

  it("zweimal rechnen legt nichts doppelt an", async () => {
    await refreshInsights(db, october);
    const first = await db.$count(insights);
    await refreshInsights(db, october);
    expect(await db.$count(insights)).toBe(first);
  });
});

describe("budgetStatus", () => {
  it("rechnet die Ausgaben je Budget für den Bezugsmonat, Umbuchungen nicht mit", async () => {
    const { month, items } = await budgetStatus(db, october);
    expect(month).toBe("2026-09");
    // REWE 63,12 + 77,30, ALDI 41,87, Lidl 35,60, Bäckerei 8,40 in September.
    expect(items.find((i) => i.categoryName === "Lebensmittel")).toMatchObject({
      spentCents: 22629,
      budgetCents: 45000,
      projectedCents: null,
    });
  });
});

describe("Monatswechsel", () => {
  it("offene Hinweise des Vormonats verschwinden, sobald Buchungen im neuen Monat da sind", async () => {
    await db.update(budgets).set({ amountCents: 10000 }).where(eq(budgets.categoryId, foodId));
    await refreshInsights(db, october);
    expect((await openInsights(db, 100)).some((i) => i.month === "2026-09")).toBe(true);

    const [account] = await db.select().from(accounts);
    await importCsv(db, {
      accountId: account?.id ?? "",
      filename: "oktober.csv",
      bytes: new TextEncoder().encode(
        "Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung\n02.10.2026;02.10.2026;Bäckerei;Brötchen;-3,20;EUR\n",
      ),
      model: null,
    });
    await refreshInsights(db, october);
    expect((await openInsights(db, 100)).filter((i) => i.month === "2026-09")).toEqual([]);
  });
});

describe("Abo kündigen", () => {
  async function spotifyIn(date: string) {
    const [account] = await db.select().from(accounts);
    const [d, m, y] = date.split(".");
    await importCsv(db, {
      accountId: account?.id ?? "",
      filename: "spaeter.csv",
      bytes: new TextEncoder().encode(
        `Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung\n${d}.${m}.${y};${d}.${m}.${y};Spotify AB;Spotify Premium;-10,99;EUR\n`,
      ),
      model: null,
    });
  }
  const titles = async () => (await openInsights(db, 100)).map((i) => i.title);

  it("erkanntes Abo erscheint einzeln mit Händler, damit die Glocke „Kündigen“ anbieten kann", async () => {
    await refreshInsights(db, october);
    const [spotify] = (await openInsights(db, 100)).filter((i) => i.title === "Abo erkannt: Spotify AB");
    expect(spotify).toMatchObject({ kind: "subscription_found", subject: "Spotify AB" });
    expect(spotify?.body).toContain("10,99 € im Monat");
  });

  it("gekündigt: Abo-Hinweis weg; bucht es weiter ab, kommt eine Warnung; zurücknehmen bringt es zurück", async () => {
    const september = new Date("2026-09-10T12:00:00Z");
    await refreshInsights(db, september);
    await markCancelled(db, "Spotify AB", september);
    expect(await titles()).not.toContain("Abo erkannt: Spotify AB");

    await spotifyIn("07.10.2026");
    await refreshInsights(db, october);
    const [failed] = (await openInsights(db, 100)).filter((i) => i.kind === "cancellation_failed");
    expect(failed).toMatchObject({ title: "Spotify AB bucht trotz Kündigung weiter ab", subject: "Spotify AB" });
    expect(failed?.body).toContain("Gekündigt am 10.09.2026, am 07.10.2026 wurden trotzdem 10,99 € abgebucht");

    await undoCancellation(db, "spotify", october);
    expect(await titles()).toContain("Abo erkannt: Spotify AB");
    expect((await openInsights(db, 100)).some((i) => i.kind === "cancellation_failed")).toBe(false);
  });

  it("bleibt die nächste Abbuchung aus, meldet die App den Erfolg mit Ersparnis", async () => {
    await markCancelled(db, "Spotify AB", october);
    await refreshInsights(db, new Date("2026-10-15T12:00:00Z"));
    expect((await titles()).some((t) => t.includes("hat geklappt"))).toBe(false);
    await refreshInsights(db, new Date("2026-10-20T12:00:00Z"));
    const [ok] = (await openInsights(db, 100)).filter((i) => i.kind === "cancellation_confirmed");
    expect(ok).toMatchObject({ title: "Kündigung von Spotify AB hat geklappt" });
    expect(ok?.body).toContain("131,88 € im Jahr");
  });

  it("zweimal „gekündigt“ behält das erste Datum", async () => {
    await markCancelled(db, "Spotify AB", october);
    await markCancelled(db, "SPOTIFY AB", new Date("2026-11-01T12:00:00Z"));
    const rows = await listCancellations(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.cancelledOn).toBe("2026-10-09");
  });
});
