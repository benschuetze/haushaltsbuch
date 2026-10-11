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
export const connectionStatus = pgEnum("connection_status", ["active", "expired", "revoked", "error"]);
export const insightKind = pgEnum("insight_kind", [
  "budget_exceeded",
  "budget_warning",
  "subscriptions",
  "price_increase",
  "duplicate_service",
  "spending_spike",
  "fees",
  "subscription_found",
  "cancellation_failed",
  "cancellation_confirmed",
]);

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
    /** Why the app created this rule on its own, e.g. after a PayPal export was imported. */
    note: text("note"),
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

/** One monthly budget per category. */
export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  categoryId: uuid("category_id")
    .notNull()
    .unique()
    .references(() => categories.id, { onDelete: "cascade" }),
  amountCents: integer("amount_cents").notNull(),
  createdAt: createdAt(),
});

/**
 * Savings hints the app works out itself. The key makes regeneration idempotent: the same finding for the
 * same month updates in place and keeps its read/dismissed state.
 */
export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    kind: insightKind("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Estimated yearly saving if acted on; null when the hint is informational. */
    savingsCentsPerYear: integer("savings_cents_per_year"),
    /** The merchant a hint is about, so the bell can offer "Kündigen" right next to it. */
    subject: text("subject"),
    month: text("month").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("insights_month_idx").on(t.month)],
);

/** Small key-value store for one-off facts like "default budgets were created once". */
export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Budget = typeof budgets.$inferSelect;
export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;

/** Failed logins per hashed IP, for throttling password guessing. Rows older than a day are dropped. */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ipHash: text("ip_hash").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_ip_hash_idx").on(t.ipHash), index("login_attempts_attempted_at_idx").on(t.attemptedAt)],
);

/**
 * A consent at a bank via Enable Banking. The session id grants read access to the accounts, so it is stored
 * only encrypted (AES-256-GCM, key in the environment).
 */
export const bankConnections = pgTable("bank_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  aspspName: text("aspsp_name").notNull(),
  aspspCountry: text("aspsp_country").notNull(),
  sessionIdEncrypted: text("session_id_encrypted").notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  status: connectionStatus("status").notNull().default("active"),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: createdAt(),
});

/** Which bank account (Enable Banking uid) feeds which account in the app. */
export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => bankConnections.id, { onDelete: "cascade" }),
    accountUid: text("account_uid").notNull().unique(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    /** Only the last digits, for display. */
    ibanTail: text("iban_tail"),
    createdAt: createdAt(),
  },
  (t) => [
    index("bank_accounts_connection_id_idx").on(t.connectionId),
    index("bank_accounts_account_id_idx").on(t.accountId),
  ],
);

/**
 * OAuth-style state for the redirect to the bank and back. Single use, short lived, and bound to the browser
 * through a cookie, so a callback cannot be replayed or started by someone else.
 */
export const bankAuthStates = pgTable("bank_auth_states", {
  stateHash: text("state_hash").primaryKey(),
  aspspName: text("aspsp_name").notNull(),
  aspspCountry: text("aspsp_country").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/**
 * "I cancelled this" as told by the user. Whether it really stopped is read from later bookings,
 * never assumed: a charge after this date turns into a warning.
 */
export const subscriptionCancellations = pgTable("subscription_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** merchantKey() of the recurring payment, stable across "Netflix" / "NETFLIX.COM". */
  merchantKey: text("merchant_key").notNull().unique(),
  merchant: text("merchant").notNull(),
  cancelledOn: date("cancelled_on", { mode: "string" }).notNull(),
  createdAt: createdAt(),
});

/**
 * "Mallorca, 800 € bis Juli". The monthly share is reserved in the daily budget ("Tagesbudget"), so saving for it does not need
 * willpower at the till. Money set aside is recorded as deposits; the goal is reached when they add up.
 */
export const savingsGoals = pgTable("savings_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  targetCents: integer("target_cents").notNull(),
  /** yyyy-mm; null when the user prefers a fixed monthly amount instead of a deadline. */
  dueMonth: text("due_month"),
  monthlyCents: integer("monthly_cents"),
  achievedAt: timestamp("achieved_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const savingsDeposits = pgTable(
  "savings_deposits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => savingsGoals.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    depositedOn: date("deposited_on", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("savings_deposits_goal_id_idx").on(t.goalId)],
);

export type BankConnection = typeof bankConnections.$inferSelect;
