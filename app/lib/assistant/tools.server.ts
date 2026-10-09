import { tool } from "ai";
import { and, desc, eq, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { canAfford } from "~/lib/budget/available";
import { redactIbans } from "~/lib/categorize/llm";
import type { Db } from "~/lib/db/client";
import { categories, transactions } from "~/lib/db/schema";
import { budgetStatus, openInsights, purchasePlan, recurringPayments, spendingToday } from "~/lib/insights";
import { formatCents } from "~/lib/money";
import { MONTH_PATTERN, monthRange, monthSummary, monthsWithData } from "~/lib/queries";

const euro = (cents: number) => formatCents(cents);
const month = z.string().regex(MONTH_PATTERN).describe("Monat als JJJJ-MM, z. B. 2026-09");

/**
 * Read-only tools over the user's own data. Nothing here writes, and every text that goes back to the model
 * passes through redactIbans, like everything else that reaches the LLM.
 */
export function createAssistantTools(db: Db, now = new Date()) {
  return {
    heute_verfuegbar: tool({
      description:
        "Wie viel Geld heute frei ist und bis zum nächsten Gehalt: Einnahmen seit dem letzten Gehalt minus Ausgaben minus noch fällige Fixkosten, Abos und Sparrate, verteilt auf die restlichen Tage. Für Fragen wie „Wie viel kann ich heute ausgeben?“.",
      inputSchema: z.object({}),
      execute: async () => {
        const a = await spendingToday(db, now);
        return {
          heute: a.today,
          heuteDrin: euro(a.perDayCents),
          freiBisGehalt: euro(a.freeCents),
          tageBisGehalt: a.daysLeft,
          naechstesGehalt: a.nextIncome
            ? { von: redactIbans(a.nextIncome.name), am: a.nextIncome.date, betrag: euro(a.nextIncome.amountCents) }
            : null,
          seitLetztemGehalt: { eingenommen: euro(a.incomeCents), ausgegeben: euro(a.spentCents) },
          gehaltNochNichtGebucht: a.missingIncome ? { erwartetAm: a.missingIncome.date } : null,
          nochFaellig: a.upcoming.map((u) => ({ was: redactIbans(u.name), am: u.date, betrag: euro(u.amountCents) })),
        };
      },
    }),

    leisten: tool({
      description:
        "Prüft, ob eine Ausgabe gerade drin ist („Kann ich mir 80 € fürs Feiern leisten?“). Urteil: locker (passt in den heutigen Anteil), geht (kostet ein paar Tage), knapp, nein (bis zum Gehalt im Minus).",
      inputSchema: z.object({
        betragEuro: z.number().positive().max(1_000_000).describe("Betrag ohne Vorzeichen"),
        wofuer: z.string().max(60).optional(),
      }),
      execute: async ({ betragEuro, wofuer }) => {
        const a = await spendingToday(db, now);
        const r = canAfford(a, Math.round(betragEuro * 100));
        return {
          urteil: r.verdict,
          wofuer: wofuer ?? null,
          betrag: euro(r.amountCents),
          heuteDrinVorher: euro(a.perDayCents),
          freiBisGehaltDanach: euro(r.afterCents),
          proTagDanach: euro(r.perDayAfterCents),
          tageBisGehalt: a.daysLeft,
          naechstesGehaltAm: a.nextIncome?.date ?? null,
        };
      },
    }),

    wann_leisten: tool({
      description:
        "Für größere Wünsche („Wann kann ich mir ein iPhone für 1.200 € leisten?“, oder wenn leisten „nein“ sagt): wie viel im Schnitt pro Monat übrig bleibt (nach Ausgaben, Sparrate und Sparzielen) und ab welchem Monat der Betrag zusammen ist.",
      inputSchema: z.object({
        betragEuro: z.number().positive().max(10_000_000),
        wofuer: z.string().max(60).optional(),
      }),
      execute: async ({ betragEuro, wofuer }) => {
        const { available, plan } = await purchasePlan(db, Math.round(betragEuro * 100), now);
        return {
          wofuer: wofuer ?? null,
          betrag: euro(Math.round(betragEuro * 100)),
          jetztFrei: euro(Math.max(0, available.freeCents)),
          uebrigProMonat: euro(plan.surplusPerMonthCents),
          monateBisDahin: plan.months,
          abMonat: plan.month,
          hinweis: plan.month === null ? "Im Schnitt bleibt gerade nichts übrig; erst Ausgaben senken." : null,
        };
      },
    }),

    sparziele: tool({
      description: "Die Sparziele mit Stand, Monatsrate und was diesen Monat noch offen ist.",
      inputSchema: z.object({}),
      execute: async () => {
        const a = await spendingToday(db, now);
        return {
          ziele: a.goals.map((g) => ({
            name: redactIbans(g.name),
            ziel: euro(g.targetCents),
            gespart: euro(g.savedCents),
            proMonat: euro(g.perMonthCents),
            bisMonat: g.dueMonth,
            diesenMonatOffen: euro(g.stillToReserveCents),
          })),
        };
      },
    }),

    naechste_zahlungen: tool({
      description:
        "Was demnächst kommt und abgeht: nächstes Gehalt und fällige Fixkosten, Abos und Sparrate bis dahin. Für „Wann kommt mein Gehalt?“ oder „Was geht diese Woche noch ab?“.",
      inputSchema: z.object({}),
      execute: async () => {
        const a = await spendingToday(db, now);
        return {
          heute: a.today,
          naechstesGehalt: a.nextIncome
            ? { von: redactIbans(a.nextIncome.name), am: a.nextIncome.date, betrag: euro(a.nextIncome.amountCents) }
            : null,
          abgaenge: a.upcoming.map((u) => ({ was: redactIbans(u.name), am: u.date, betrag: euro(u.amountCents) })),
        };
      },
    }),

    monate: tool({
      description: "Liste der Monate, für die Buchungen vorhanden sind (neueste zuerst).",
      inputSchema: z.object({}),
      execute: async () => ({ monate: await monthsWithData(db) }),
    }),

    monatsuebersicht: tool({
      description: "Einnahmen, Ausgaben und Summen je Kategorie für einen Monat. Umbuchungen sind herausgerechnet.",
      inputSchema: z.object({ monat: month }),
      execute: async ({ monat }) => {
        const s = await monthSummary(db, monat);
        return {
          monat,
          einnahmen: euro(s.incomeCents),
          ausgaben: euro(s.expenseCents),
          umbuchungen: euro(s.transferCents),
          zuPruefen: s.reviewCount,
          kategorien: s.byCategory.map((c) => ({ kategorie: c.name, summe: euro(c.cents), buchungen: c.count })),
        };
      },
    }),

    buchungen_suchen: tool({
      description:
        "Sucht Buchungen nach Text (Empfänger oder Verwendungszweck), Kategorie, Monat oder Betragsspanne. Höchstens 30 Treffer, neueste zuerst.",
      inputSchema: z.object({
        suchbegriff: z.string().max(60).optional().describe("Teil von Empfänger oder Verwendungszweck"),
        kategorie: z
          .string()
          .max(40)
          .optional()
          .describe("Name der Kategorie, z. B. Lebensmittel; 'ohne' für unkategorisiert"),
        monat: month.optional(),
        nurAusgaben: z.boolean().optional(),
        mindestbetragEuro: z.number().nonnegative().optional().describe("Betrag ohne Vorzeichen"),
        limit: z.number().int().min(1).max(30).optional(),
      }),
      execute: async (input) => {
        const conditions = [];
        if (input.suchbegriff) {
          const like = `%${input.suchbegriff.replace(/[%_\\]/g, "")}%`;
          conditions.push(or(ilike(transactions.counterparty, like), ilike(transactions.purpose, like)));
        }
        if (input.kategorie === "ohne") conditions.push(isNull(transactions.categoryId));
        else if (input.kategorie) conditions.push(ilike(categories.name, input.kategorie.replace(/[%_\\]/g, "")));
        if (input.monat) {
          const { from, to } = monthRange(input.monat);
          conditions.push(gte(transactions.bookingDate, from), lt(transactions.bookingDate, to));
        }
        if (input.nurAusgaben) conditions.push(lt(transactions.amountCents, 0));
        if (input.mindestbetragEuro !== undefined) {
          conditions.push(sql`abs(${transactions.amountCents}) >= ${Math.round(input.mindestbetragEuro * 100)}`);
        }
        const rows = await db
          .select({
            datum: transactions.bookingDate,
            empfaenger: transactions.counterparty,
            zweck: transactions.purpose,
            cents: transactions.amountCents,
            kategorie: categories.name,
          })
          .from(transactions)
          .leftJoin(categories, eq(transactions.categoryId, categories.id))
          .where(and(...conditions))
          .orderBy(desc(transactions.bookingDate))
          .limit(input.limit ?? 20);
        return {
          treffer: rows.length,
          buchungen: rows.map((r) => ({
            datum: r.datum,
            empfaenger: redactIbans(r.empfaenger),
            zweck: redactIbans(r.zweck).slice(0, 120),
            betrag: euro(r.cents),
            kategorie: r.kategorie ?? "ohne Kategorie",
          })),
        };
      },
    }),

    abos_und_fixkosten: tool({
      description:
        "Erkannte wiederkehrende Zahlungen: Abos, feste Kosten und beendete. Mit Rhythmus, letztem Betrag, Jahreskosten und Preisänderung. Erkennt auch Abos, die nicht als Abo kategorisiert sind.",
      inputSchema: z.object({}),
      execute: async () => {
        const all = await recurringPayments(db);
        return {
          zahlungen: all.map((r) => ({
            name: redactIbans(r.merchant),
            art: r.active ? (r.kind === "subscription" ? "Abo" : "Fixkosten") : "beendet",
            rhythmus: r.cadence,
            kategorie: r.categoryName ?? "ohne Kategorie",
            letzterBetrag: euro(r.lastAmountCents),
            vorherigerBetrag: r.previousAmountCents === null ? null : euro(r.previousAmountCents),
            proJahr: euro(r.yearlyCents),
            zuletzt: r.lastDate,
            anzahl: r.occurrences,
          })),
        };
      },
    }),

    budgets: tool({
      description: "Monatsbudgets mit bisherigen Ausgaben und Hochrechnung für den aktuellen Monat.",
      inputSchema: z.object({}),
      execute: async () => {
        const { month: m, items } = await budgetStatus(db);
        return {
          monat: m,
          budgets: items.map((b) => ({
            kategorie: b.categoryName,
            budget: euro(b.budgetCents),
            ausgegeben: euro(b.spentCents),
            prozent: Math.round((b.spentCents / b.budgetCents) * 100),
            hochrechnung: b.projectedCents === null ? null : euro(b.projectedCents),
          })),
        };
      },
    }),

    hinweise: tool({
      description: "Offene Spar-Hinweise der App (Budgets, Preiserhöhungen, doppelte Dienste, Ausreißer, Gebühren).",
      inputSchema: z.object({}),
      execute: async () => ({
        hinweise: (await openInsights(db, 20)).map((i) => ({
          titel: i.title,
          text: i.body,
          sparpotenzialProJahr: i.savingsCentsPerYear ? euro(i.savingsCentsPerYear) : null,
        })),
      }),
    }),

    verlauf_kategorie: tool({
      description: "Ausgaben einer Kategorie über die letzten Monate, um Entwicklungen zu sehen.",
      inputSchema: z.object({ kategorie: z.string().max(40), monate: z.number().int().min(2).max(12).optional() }),
      execute: async ({ kategorie, monate }) => {
        const [cat] = await db
          .select()
          .from(categories)
          .where(ilike(categories.name, kategorie.replace(/[%_\\]/g, "")));
        if (!cat) return { fehler: `Keine Kategorie „${kategorie}“` };
        const months = (await monthsWithData(db)).slice(0, monate ?? 6);
        const verlauf = [];
        for (const m of months) {
          const { from, to } = monthRange(m);
          const [row] = await db
            .select({ sum: sql<string>`coalesce(sum(${transactions.amountCents}), 0)` })
            .from(transactions)
            .where(
              and(
                eq(transactions.categoryId, cat.id),
                gte(transactions.bookingDate, from),
                lt(transactions.bookingDate, to),
              ),
            );
          verlauf.push({ monat: m, summe: euro(Number(row?.sum ?? 0)) });
        }
        return { kategorie: cat.name, verlauf };
      },
    }),
  };
}
