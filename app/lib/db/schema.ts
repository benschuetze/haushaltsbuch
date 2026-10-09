import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ColumnMapping } from "~/lib/import/formats/mapping";

export const categoryKind = pgEnum("category_kind", ["expense", "income", "transfer"]);
export const categorySource = pgEnum("category_source", ["rule", "ai", "manual"]);
export const ruleField = pgEnum("rule_field", ["counterparty", "purpose"]);
export const ruleMatchType = pgEnum("rule_match_type", ["contains", "equals", "regex"]);
export const formatSource = pgEnum("format_source", ["heuristic", "ai"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  /** Built-in profile id ("sparkasse") or "format:<uuid>" for a learned format. */
  bankProfile: text("bank_profile").notNull(),
  /** Profile plus a hash of the own IBAN: lets an upload find its account without the user choosing one. */
  accountKey: text("account_key").unique(),
  createdAt: createdAt(),
});

/** Bank formats the app worked out itself, so the next export of the same bank needs neither guessing nor the LLM. */
export const bankFormats = pgTable("bank_formats", {
  id: uuid("id").primaryKey().defaultRandom(),
  label: text("label").notNull(),
  headerSignature: text("header_signature").notNull().unique(),
  mapping: jsonb("mapping").$type<ColumnMapping>().notNull(),
  source: formatSource("source").notNull(),
  createdAt: createdAt(),
});

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    filename: text("filename").notNull(),
    rowCount: integer("row_count").notNull(),
    importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("imports_account_id_idx").on(t.accountId)],
);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  kind: categoryKind("kind").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id),
    bookingDate: date("booking_date", { mode: "string" }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("EUR"),
    counterparty: text("counterparty").notNull(),
    purpose: text("purpose").notNull(),
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    dedupeHash: text("dedupe_hash").notNull().unique(),
    categoryId: uuid("category_id").references(() => categories.id),
    categorySource: categorySource("category_source"),
    aiConfidence: real("ai_confidence"),
    needsReview: boolean("needs_review").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("transactions_account_id_idx").on(t.accountId),
    index("transactions_import_id_idx").on(t.importId),
    index("transactions_category_id_idx").on(t.categoryId),
    index("transactions_booking_date_idx").on(t.bookingDate),
    index("transactions_needs_review_idx").on(t.needsReview).where(sql`${t.needsReview}`),
  ],
);

export const rules = pgTable(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    field: ruleField("field").notNull(),
    matchType: ruleMatchType("match_type").notNull(),
    pattern: text("pattern").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    priority: integer("priority").notNull().default(0),
    createdFromTransactionId: uuid("created_from_transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("rules_category_id_idx").on(t.categoryId),
    index("rules_created_from_transaction_id_idx").on(t.createdFromTransactionId),
  ],
);

export type Account = typeof accounts.$inferSelect;
export type BankFormat = typeof bankFormats.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Rule = typeof rules.$inferSelect;
