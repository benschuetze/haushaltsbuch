import { createHash, timingSafeEqual } from "node:crypto";
import { data } from "react-router";
import { bankClient } from "~/lib/bank/index.server";
import { syncAll } from "~/lib/bank/sync.server";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { refreshInsights } from "~/lib/insights";
import type { Route } from "./+types/bank.sync";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = request.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

/**
 * Called daily by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. Answers only with counts,
 * never with bookings, so even a leaked response tells nothing about the finances.
 */
export async function loader({ request }: Route.LoaderArgs) {
  if (!authorized(request)) return data({ ok: false }, { status: 401 });
  const client = bankClient();
  if (!client) return data({ ok: true, skipped: "nicht eingerichtet" });
  const db = getDb();
  const results = await syncAll(db, client, getModel());
  await refreshInsights(db);
  return data({
    ok: true,
    connections: results.length,
    inserted: results.reduce((s, r) => s + r.inserted, 0),
    failed: results.filter((r) => r.error).length,
  });
}
