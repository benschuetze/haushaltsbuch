import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import * as schema from "./schema";

/** Every driver (neon-http, node-postgres, PGlite) fits this, so app code never cares which one runs. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let db: Db | undefined;

export function createDb(url: string): Db {
  // Neon over HTTP suits serverless: no socket to keep alive between invocations.
  if (new URL(url).hostname.endsWith(".neon.tech")) {
    return drizzleNeon(neon(url), { schema });
  }
  return drizzleNodePg(new pg.Pool({ connectionString: url }), { schema });
}

export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL fehlt");
    db = createDb(url);
  }
  return db;
}

/** Tests inject a PGlite database. */
export function setDb(next: Db): void {
  db = next;
}
