import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/** Applies migrations one by one, so a data migration can be tested against the state before it. */
async function databaseBefore(migration: string) {
  const client = new PGlite();
  const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
  for (const { tag } of journal.entries) {
    if (tag === migration) break;
    for (const statement of readFileSync(`drizzle/${tag}.sql`, "utf8").split("--> statement-breakpoint")) {
      await client.exec(statement);
    }
  }
  return client;
}

const RENAME = readFileSync("drizzle/0003_rename-hobbys.sql", "utf8");

async function seedOld(client: PGlite, withHobbys: boolean) {
  await client.exec(`
    insert into categories (name, kind, color, sort_order) values ('Musik & Equipment', 'expense', '#000', 1);
    ${withHobbys ? "insert into categories (name, kind, color, sort_order) values ('Hobbys', 'expense', '#000', 2);" : ""}
    insert into accounts (name, bank_profile) values ('Giro', 'demo');
    insert into imports (account_id, filename, row_count) select id, 'a.csv', 1 from accounts;
    insert into transactions (account_id, import_id, booking_date, amount_cents, counterparty, purpose, raw, dedupe_hash, category_id)
      select a.id, i.id, '2026-09-20', -14900, 'Thomann', 'Einkauf', '{}', 'h1', c.id
      from accounts a, imports i, categories c where c.name = 'Musik & Equipment';
    insert into rules (field, match_type, pattern, category_id) select 'counterparty', 'equals', 'Thomann', id from categories where name = 'Musik & Equipment';
    insert into budgets (category_id, amount_cents) select id, 6000 from categories where name = 'Musik & Equipment';
  `);
}

async function state(client: PGlite) {
  const q = async (sql: string) => (await client.query<Record<string, unknown>>(sql)).rows;
  return {
    categories: (await q("select name from categories order by name")).map((r) => r.name),
    tx: (await q("select c.name from transactions t join categories c on c.id = t.category_id")).map((r) => r.name),
    rule: (await q("select c.name from rules r join categories c on c.id = r.category_id")).map((r) => r.name),
    budget: (await q("select c.name, b.amount_cents from budgets b join categories c on c.id = b.category_id")).map(
      (r) => `${r.name}:${r.amount_cents}`,
    ),
  };
}

describe("Migration Musik & Equipment → Hobbys", () => {
  it("benennt um, Buchungen, Regel und Budget bleiben dran", async () => {
    const client = await databaseBefore("0003_rename-hobbys");
    await seedOld(client, false);
    await client.exec(RENAME);
    expect(await state(client)).toEqual({
      categories: ["Hobbys"],
      tx: ["Hobbys"],
      rule: ["Hobbys"],
      budget: ["Hobbys:6000"],
    });
  });

  it("gibt es Hobbys schon, wird zusammengeführt statt etwas zu verlieren", async () => {
    const client = await databaseBefore("0003_rename-hobbys");
    await seedOld(client, true);
    await client.exec(RENAME);
    expect(await state(client)).toEqual({
      categories: ["Hobbys"],
      tx: ["Hobbys"],
      rule: ["Hobbys"],
      budget: ["Hobbys:6000"],
    });
  });

  it("auf einer leeren Datenbank passiert nichts", async () => {
    const client = await databaseBefore("0003_rename-hobbys");
    await client.exec(RENAME);
    expect((await state(client)).categories).toEqual([]);
  });
});
