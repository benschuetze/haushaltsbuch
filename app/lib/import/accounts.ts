import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "~/lib/db/client";
import { type Account, accounts } from "~/lib/db/schema";

/** The IBAN itself is not stored as a key; a hash is enough to recognise the account again. */
export function accountKey(profileKey: string, ownIban: string | undefined): string {
  if (!ownIban) return `${profileKey}:default`;
  return `${profileKey}:${createHash("sha256").update(ownIban).digest("hex").slice(0, 16)}`;
}

/**
 * Finds the account an upload belongs to, or creates it. An account the user created by hand for the same bank
 * is adopted instead of opening a second one, which would count every booking twice.
 */
export async function resolveAccount(
  db: Db,
  input: { profileKey: string; label: string; ownIban?: string },
): Promise<{ account: Account; created: boolean }> {
  const key = accountKey(input.profileKey, input.ownIban);
  const [existing] = await db.select().from(accounts).where(eq(accounts.accountKey, key));
  if (existing) return { account: existing, created: false };

  const unkeyed = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.bankProfile, input.profileKey), isNull(accounts.accountKey)));
  if (unkeyed.length === 1 && unkeyed[0]) {
    const [adopted] = await db
      .update(accounts)
      .set({ accountKey: key })
      .where(eq(accounts.id, unkeyed[0].id))
      .returning();
    if (adopted) return { account: adopted, created: false };
  }

  const base = input.ownIban ? `${input.label} ··${input.ownIban.slice(-4)}` : input.label;
  for (let n = 1; n < 50; n++) {
    const name = n === 1 ? base : `${base} (${n})`;
    const [created] = await db
      .insert(accounts)
      .values({ name, bankProfile: input.profileKey, accountKey: key })
      .onConflictDoNothing()
      .returning();
    if (created) return { account: created, created: true };
    // A parallel upload may have created the same key in the meantime.
    const [raced] = await db.select().from(accounts).where(eq(accounts.accountKey, key));
    if (raced) return { account: raced, created: false };
  }
  throw new Error("Kein freier Kontoname gefunden");
}
