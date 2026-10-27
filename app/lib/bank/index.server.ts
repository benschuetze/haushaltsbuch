import { and, eq, lt, or, sql } from "drizzle-orm";
import { clockNow } from "~/lib/clock";
import type { Db } from "~/lib/db/client";
import { accounts, bankAccounts, bankConnections } from "~/lib/db/schema";
import { bankConfig, EnableBankingClient } from "./enable-banking.server";

export function bankClient(): EnableBankingClient | null {
  const config = bankConfig();
  return config ? new EnableBankingClient(config) : null;
}

export async function listConnections(db: Db) {
  const rows = await db
    .select({
      id: bankConnections.id,
      aspspName: bankConnections.aspspName,
      status: bankConnections.status,
      validUntil: bankConnections.validUntil,
      lastSyncAt: bankConnections.lastSyncAt,
      lastError: bankConnections.lastError,
      accountName: accounts.name,
      ibanTail: bankAccounts.ibanTail,
    })
    .from(bankConnections)
    .leftJoin(bankAccounts, eq(bankAccounts.connectionId, bankConnections.id))
    .leftJoin(accounts, eq(bankAccounts.accountId, accounts.id))
    .orderBy(bankConnections.createdAt);
  const byId = new Map<string, Omit<(typeof rows)[number], "accountName" | "ibanTail"> & { accounts: string[] }>();
  for (const r of rows) {
    const entry = byId.get(r.id) ?? { ...r, accounts: [] };
    if (r.accountName) entry.accounts.push(r.accountName);
    byId.set(r.id, entry);
  }
  return [...byId.values()];
}

const WARN_DAYS = 7;

/** Connections that need the user: expired, failing, or running out within a week. */
export async function bankIssues(db: Db, now = clockNow()) {
  const soon = new Date(now.getTime() + WARN_DAYS * 86_400_000);
  const rows = await db
    .select({
      id: bankConnections.id,
      aspspName: bankConnections.aspspName,
      status: bankConnections.status,
      validUntil: bankConnections.validUntil,
      lastError: bankConnections.lastError,
    })
    .from(bankConnections)
    .where(
      or(
        eq(bankConnections.status, "expired"),
        eq(bankConnections.status, "error"),
        and(eq(bankConnections.status, "active"), lt(bankConnections.validUntil, soon)),
        and(eq(bankConnections.status, "active"), sql`${bankConnections.lastError} is not null`),
      ),
    );
  return rows.map((r) => {
    const days = Math.ceil((r.validUntil.getTime() - now.getTime()) / 86_400_000);
    const title =
      r.status !== "active" || days <= 0
        ? `Bankzugang ${r.aspspName} erneuern`
        : r.lastError
          ? `Abruf bei ${r.aspspName} fehlgeschlagen`
          : `Bankzugang ${r.aspspName} läuft in ${days === 1 ? "1 Tag" : `${days} Tagen`} ab`;
    return { id: r.id, title };
  });
}
