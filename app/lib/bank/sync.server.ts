import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { LanguageModel } from "ai";
import { and, eq, lt } from "drizzle-orm";
import { clockNow } from "~/lib/clock";
import { decryptSecret, encryptSecret } from "~/lib/crypto.server";
import type { Db } from "~/lib/db/client";
import { accounts, type BankConnection, bankAccounts, bankAuthStates, bankConnections } from "~/lib/db/schema";
import { resolveAccount } from "~/lib/import/accounts";
import { storeParsed } from "~/lib/import/run";
import type { NormalizedRow, ParseResult } from "~/lib/import/types";
import { parseEnglishAmount } from "~/lib/money";
import { log } from "~/lib/observability/log.server";
import { safeError } from "~/lib/security.server";
import {
  BankApiError,
  type BankTransaction,
  type EnableBankingClient,
  transactionSchema,
} from "./enable-banking.server";

const STATE_TTL_MS = 15 * 60 * 1000;
/** First sync reaches back a year; later ones overlap ten days, so late bookings are not missed. */
const FIRST_SYNC_DAYS = 365;
const OVERLAP_DAYS = 10;
const MAX_PAGES = 40;
/** PSD2 allows up to 180 days of consent; banks may grant less. */
const CONSENT_DAYS = 180;

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export async function createAuthState(db: Db, aspsp: { name: string; country: string }, now = clockNow()) {
  const state = randomBytes(32).toString("base64url");
  await db.delete(bankAuthStates).where(lt(bankAuthStates.expiresAt, now));
  await db.insert(bankAuthStates).values({
    stateHash: hashState(state),
    aspspName: aspsp.name,
    aspspCountry: aspsp.country,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  });
  return { state, validUntil: new Date(now.getTime() + CONSENT_DAYS * 86_400_000) };
}

/**
 * The state from the bank's redirect must match the one in this browser's cookie, exist, be fresh and unused.
 * It is deleted on first use, so a callback URL cannot be replayed.
 */
export async function consumeAuthState(db: Db, fromUrl: string | null, fromCookie: string | null, now = clockNow()) {
  if (!fromUrl || !fromCookie) return null;
  const a = Buffer.from(hashState(fromUrl));
  const b = Buffer.from(hashState(fromCookie));
  if (!timingSafeEqual(a, b)) return null;
  const [row] = await db
    .delete(bankAuthStates)
    .where(eq(bankAuthStates.stateHash, hashState(fromUrl)))
    .returning();
  if (!row || row.expiresAt < now) return null;
  return { name: row.aspspName, country: row.aspspCountry };
}

export function mapTransaction(
  raw: unknown,
): { row: Omit<NormalizedRow, "line"> } | { skip: string } | { reject: string } {
  const parsed = transactionSchema.safeParse(raw);
  if (!parsed.success) return { reject: "Buchung in unerwartetem Format" };
  const t: BankTransaction = parsed.data;
  if (t.status && t.status !== "BOOK") return { skip: "vorgemerkt, noch nicht gebucht – kommt mit dem nächsten Abruf" };
  const date = t.booking_date ?? t.value_date ?? t.transaction_date;
  if (!date) return { reject: "Buchung ohne Datum" };
  let amount: number;
  try {
    amount = Math.abs(parseEnglishAmount(t.transaction_amount.amount));
  } catch {
    return { reject: "Betrag nicht lesbar" };
  }
  const outgoing = t.credit_debit_indicator === "DBIT";
  const purpose = (t.remittance_information ?? []).join(" ").replace(/\s+/g, " ").trim();
  const counterparty = (outgoing ? t.creditor?.name : t.debtor?.name)?.trim() || purpose.slice(0, 60) || "Unbekannt";
  return {
    row: {
      bookingDate: date.slice(0, 10),
      amountCents: outgoing ? -amount : amount,
      currency: t.transaction_amount.currency,
      counterparty,
      purpose,
      raw: {
        quelle: "Bankabruf",
        entry_reference: t.entry_reference ?? "",
        transaction_id: t.transaction_id ?? "",
        status: t.status ?? "",
      },
    },
  };
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Saves a new consent and links its accounts to accounts in the app (found by IBAN or created). */
export async function completeConnection(
  db: Db,
  client: EnableBankingClient,
  aspsp: { name: string; country: string },
  code: string,
): Promise<BankConnection> {
  const session = await client.createSession(code);
  const validUntil = session.access?.valid_until
    ? new Date(session.access.valid_until)
    : new Date(clockNow().getTime() + CONSENT_DAYS * 86_400_000);
  const [connection] = await db
    .insert(bankConnections)
    .values({
      aspspName: aspsp.name,
      aspspCountry: aspsp.country,
      sessionIdEncrypted: encryptSecret(session.session_id),
      validUntil,
    })
    .returning();
  if (!connection) throw new Error("Verbindung konnte nicht gespeichert werden");

  for (const acc of session.accounts) {
    const iban = acc.account_id?.iban?.replaceAll(" ", "");
    const { account } = await resolveAccount(db, {
      profileKey: `bank:${aspsp.name}`,
      label: aspsp.name,
      ownIban: iban,
    });
    await db
      .insert(bankAccounts)
      .values({
        connectionId: connection.id,
        accountUid: acc.uid,
        accountId: account.id,
        ibanTail: iban?.slice(-4) ?? null,
      })
      .onConflictDoUpdate({
        target: bankAccounts.accountUid,
        set: { connectionId: connection.id, accountId: account.id },
      });
  }
  return connection;
}

export type SyncResult = {
  connectionId: string;
  inserted: number;
  duplicates: number;
  skipped: number;
  rejected: number;
  error?: string;
};

export async function syncConnection(
  db: Db,
  client: EnableBankingClient,
  connection: BankConnection,
  model: LanguageModel | null,
  now = clockNow(),
): Promise<SyncResult> {
  const result: SyncResult = { connectionId: connection.id, inserted: 0, duplicates: 0, skipped: 0, rejected: 0 };
  if (connection.status !== "active") return { ...result, error: "Verbindung nicht aktiv" };
  if (connection.validUntil < now) {
    await db.update(bankConnections).set({ status: "expired" }).where(eq(bankConnections.id, connection.id));
    return { ...result, error: "Zugang abgelaufen" };
  }
  const links = await db
    .select({ uid: bankAccounts.accountUid, account: accounts })
    .from(bankAccounts)
    .innerJoin(accounts, eq(bankAccounts.accountId, accounts.id))
    .where(eq(bankAccounts.connectionId, connection.id));
  const from = connection.lastSyncAt
    ? new Date(connection.lastSyncAt.getTime() - OVERLAP_DAYS * 86_400_000)
    : new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000);

  try {
    for (const link of links) {
      const parsed: ParseResult = { rows: [], rejected: [], skipped: [] };
      let key: string | undefined;
      let line = 1;
      for (let page = 0; page < MAX_PAGES; page++) {
        const { transactions, continuationKey } = await client.transactions(link.uid, isoDay(from), key);
        for (const raw of transactions) {
          line++;
          const m = mapTransaction(raw);
          if ("row" in m) parsed.rows.push({ line, ...m.row });
          else if ("skip" in m) parsed.skipped.push({ line, reason: m.skip });
          else parsed.rejected.push({ line, reason: m.reject });
        }
        if (!continuationKey) break;
        key = continuationKey;
      }
      const stored = await storeParsed(db, link.account, parsed, {
        filename: `Bankabruf ${connection.aspspName}`,
        model,
      });
      result.inserted += stored.inserted;
      result.duplicates += stored.duplicates;
      result.skipped += stored.skipped.length;
      result.rejected += stored.rejected.length;
    }
    await db
      .update(bankConnections)
      .set({ lastSyncAt: now, lastError: null })
      .where(eq(bankConnections.id, connection.id));
    return result;
  } catch (error) {
    const reconsent = error instanceof BankApiError && error.needsReconsent;
    await db
      .update(bankConnections)
      .set({ status: reconsent ? "expired" : "active", lastError: safeError(error) })
      .where(eq(bankConnections.id, connection.id));
    return { ...result, error: reconsent ? "Zugang abgelaufen oder widerrufen" : "Abruf fehlgeschlagen" };
  }
}

export async function syncAll(db: Db, client: EnableBankingClient, model: LanguageModel | null, now = clockNow()) {
  const active = await db.select().from(bankConnections).where(eq(bankConnections.status, "active"));
  const results: SyncResult[] = [];
  // One after another: banks limit unattended calls, and parallel writes to the same account gain nothing.
  for (const c of active) results.push(await syncConnection(db, client, c, model, now));
  return results;
}

export async function disconnect(db: Db, client: EnableBankingClient, connectionId: string): Promise<void> {
  const [c] = await db.select().from(bankConnections).where(eq(bankConnections.id, connectionId));
  if (!c) return;
  try {
    await client.deleteSession(decryptSecret(c.sessionIdEncrypted));
  } catch (error) {
    // Already gone at the bank is fine; anything else is logged without details.
    log.error({ event: "bank_revoke_failed", err: safeError(error) }, "Bankzugang beim Trennen nicht widerrufen");
  }
  // The secret is removed even if the bank call failed; bookings already imported stay.
  await db
    .update(bankConnections)
    .set({ status: "revoked", sessionIdEncrypted: "", lastError: null })
    .where(and(eq(bankConnections.id, connectionId)));
}
