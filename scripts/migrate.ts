import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { migrate as migrateNeon } from "drizzle-orm/neon-http/migrator";
import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import { migrate as migrateNodePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL fehlt");
const migrationsFolder = "drizzle";

if (new URL(url).hostname.endsWith(".neon.tech")) {
  await migrateNeon(drizzleNeon(neon(url)), { migrationsFolder });
} else {
  const pool = new pg.Pool({ connectionString: url });
  await migrateNodePg(drizzleNodePg(pool), { migrationsFolder });
  await pool.end();
}
console.log("Migrationen angewendet");
