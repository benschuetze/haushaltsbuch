import type { Db } from "./client";
import { accounts, categories, type NewCategory } from "./schema";

export const DEFAULT_CATEGORIES: Omit<NewCategory, "sortOrder">[] = [
  { name: "Wohnen", kind: "expense", color: "#2a78d6" },
  { name: "Lebensmittel", kind: "expense", color: "#1f9d6b" },
  { name: "Kind & Kita", kind: "expense", color: "#e0892b" },
  { name: "Mobilität", kind: "expense", color: "#7a5cd6" },
  { name: "Versicherungen", kind: "expense", color: "#5b6b7f" },
  { name: "Abos & Software", kind: "expense", color: "#d6457a" },
  { name: "Musik & Equipment", kind: "expense", color: "#b8862a" },
  { name: "Gesundheit", kind: "expense", color: "#2aa5b8" },
  { name: "Freizeit", kind: "expense", color: "#6aa82a" },
  { name: "Kleidung", kind: "expense", color: "#a8552a" },
  { name: "Haushalt", kind: "expense", color: "#8a8f2a" },
  { name: "Einkommen", kind: "income", color: "#178a3c" },
  { name: "Umbuchung", kind: "transfer", color: "#8c8c8c" },
  { name: "Sonstiges", kind: "expense", color: "#6f6f6f" },
];

export const DEMO_ACCOUNT = { name: "Girokonto (Demo)", bankProfile: "demo" } as const;

/** Idempotent: safe on every deploy and before every test run. */
export async function seed(db: Db): Promise<void> {
  await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i })))
    .onConflictDoNothing({ target: categories.name });
  await db.insert(accounts).values(DEMO_ACCOUNT).onConflictDoNothing({ target: accounts.name });
}
