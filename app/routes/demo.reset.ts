import { redirect } from "react-router";
import { isDemo } from "~/lib/auth.server";
import { takeFromDailyBudget } from "~/lib/daily-budget.server";
import { getDb } from "~/lib/db/client";
import { RESET_BUDGET, resetDemo } from "~/lib/demo-reset.server";
import type { Route } from "./+types/demo.reset";

/** Resets are cheap but not free (a full import each time); this many a day is plenty for honest visitors. */
const RESETS_PER_DAY = 100;

export async function action(_: Route.ActionArgs) {
  if (!isDemo()) throw new Response("Nur in der Demo.", { status: 404 });
  const db = getDb();
  if ((await takeFromDailyBudget(db, RESET_BUDGET, 1, RESETS_PER_DAY)) === 0) {
    return redirect("/?zurueckgesetzt=limit");
  }
  await resetDemo(db);
  return redirect("/?zurueckgesetzt=1");
}

export function loader() {
  return redirect("/");
}
