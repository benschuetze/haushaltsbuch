import { createHash, timingSafeEqual } from "node:crypto";
import { data } from "react-router";
import { bankClient } from "~/lib/bank/index.server";
import { syncAll } from "~/lib/bank/sync.server";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { refreshInsights } from "~/lib/insights";
import { log } from "~/lib/observability/log.server";
import { reviewShare } from "~/lib/observability/review-alarm";
import { flushReports } from "~/lib/observability/sentry.server";
import type { Route } from "./+types/bank.sync";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = request.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

/** Daily health check on the categorisation; see review-alarm.ts for why this signals a broken model. */
async function checkReviewShare(db: ReturnType<typeof getDb>) {
  const r = await reviewShare(db);
  const fields = { event: "review_share_high", total: r.total, open: r.open, share: Math.round(r.share * 100) / 100 };
  if (r.alarm) log.warn(fields, `${Math.round(r.share * 100)} % der neuen Buchungen warten auf „prüfen“`);
  else log.info({ ...fields, event: "review_share" }, "Anteil „prüfen“ im Rahmen");
  return r;
}

/**
 * Called daily by Vercel Cron with `Authorization: Bearer $CRON_SECRET`. Answers only with counts,
 * never with bookings, so even a leaked response tells nothing about the finances.
 */
export async function loader({ request }: Route.LoaderArgs) {
  if (!authorized(request)) return data({ ok: false }, { status: 401 });
  const db = getDb();
  // Before the bank sync, so the check also runs on instances without a bank connection.
  const review = await checkReviewShare(db);
  const client = bankClient();
  if (!client) {
    await flushReports();
    return data({ ok: true, skipped: "nicht eingerichtet", reviewAlarm: review.alarm });
  }
  const results = await syncAll(db, client, getModel());
  await refreshInsights(db);
  await flushReports();
  return data({
    reviewAlarm: review.alarm,
    ok: true,
    connections: results.length,
    inserted: results.reduce((s, r) => s + r.inserted, 0),
    failed: results.filter((r) => r.error).length,
  });
}
