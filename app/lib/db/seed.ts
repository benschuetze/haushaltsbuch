import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { accounts, budgets, categories, meta, type NewCategory } from "./schema";

export const DEFAULT_CATEGORIES: Omit<NewCategory, "sortOrder">[] = [
  { name: "Wohnen", kind: "expense", color: "#2a78d6" },
  { name: "Lebensmittel", kind: "expense", color: "#1f9d6b" },
  { name: "Kind & Kita", kind: "expense", color: "#e0892b" },
  { name: "Mobilität", kind: "expense", color: "#7a5cd6" },
  { name: "Versicherungen", kind: "expense", color: "#5b6b7f" },
  { name: "Abos & Software", kind: "expense", color: "#d6457a" },
  { name: "Hobbys", kind: "expense", color: "#b8862a" },
  { name: "Gesundheit", kind: "expense", color: "#2aa5b8" },
  { name: "Freizeit", kind: "expense", color: "#6aa82a" },
  { name: "Kleidung", kind: "expense", color: "#a8552a" },
  { name: "Haushalt", kind: "expense", color: "#8a8f2a" },
  { name: "Restaurant & Lieferdienst", kind: "expense", color: "#d65f2a" },
  { name: "Haustier", kind: "expense", color: "#9a6b4a" },
  { name: "Gebühren", kind: "expense", color: "#b03a3a" },
  { name: "Einkommen", kind: "income", color: "#178a3c" },
  { name: "Umbuchung", kind: "transfer", color: "#8c8c8c" },
  { name: "Sonstiges", kind: "expense", color: "#6f6f6f" },
];

/** Starting points, in euros per month. Users change or delete them; they are created only once. */
export const DEFAULT_BUDGETS: Record<string, number> = {
  Lebensmittel: 450,
  "Restaurant & Lieferdienst": 120,
  Freizeit: 150,
  "Abos & Software": 50,
  Kleidung: 80,
  Mobilität: 180,
  Haushalt: 70,
  Hobbys: 60,
  Gesundheit: 40,
};

export const DEMO_ACCOUNT = { name: "Girokonto (Demo)", bankProfile: "demo", accountKey: "demo:default" } as const;

/** Idempotent: safe on every deploy and before every test run. */
export async function seed(db: Db): Promise<void> {
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
    .onConflictDoNothing({ target: categories.name });
  // Older databases have the demo account without a key; giving it one lets uploads of the demo file find it.
  await db
    .insert(accounts)
    .values(DEMO_ACCOUNT)
    .onConflictDoUpdate({
      target: accounts.name,
      set: { accountKey: sql`coalesce(${accounts.accountKey}, excluded.account_key)` },
    });

  await seedBudgetsOnce(db);
}

async function seedBudgetsOnce(db: Db): Promise<void> {
  const [marker] = await db
    .insert(meta)
    .values({ key: "default_budgets_seeded", value: new Date().toISOString() })
    .onConflictDoNothing()
    .returning();
  // Already done once: a budget the user deleted must not come back with the next deploy.
  if (!marker) return;
  const rows = await db.select({ id: categories.id, name: categories.name }).from(categories);
  const values = rows
    .filter((c) => DEFAULT_BUDGETS[c.name] !== undefined)
    .map((c) => ({ categoryId: c.id, amountCents: (DEFAULT_BUDGETS[c.name] ?? 0) * 100 }));
  if (values.length > 0) await db.insert(budgets).values(values).onConflictDoNothing();
}
