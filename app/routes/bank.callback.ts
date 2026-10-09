import { redirect } from "react-router";
import { bankClient } from "~/lib/bank/index.server";
import { bankStateCookie } from "~/lib/bank/state-cookie.server";
import { completeConnection, consumeAuthState, syncConnection } from "~/lib/bank/sync.server";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { refreshInsights } from "~/lib/insights";
import { safeError } from "~/lib/security.server";
import type { Route } from "./+types/bank.callback";

/** The bank sends the user back here. Accepted only with the matching, fresh, unused state from this browser. */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const cookie = bankStateCookie();
  const clear = { "Set-Cookie": await cookie.serialize("", { maxAge: 0 }) };
  const client = bankClient();
  if (!client) return redirect("/banken", { headers: clear });

  const db = getDb();
  const fromCookie = (await cookie.parse(request.headers.get("Cookie"))) as string | null;
  const aspsp = await consumeAuthState(db, url.searchParams.get("state"), fromCookie);
  if (!aspsp) return redirect("/banken?fehler=state", { headers: clear });
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) return redirect("/banken?fehler=abgebrochen", { headers: clear });

  try {
    const connection = await completeConnection(db, client, aspsp, code);
    const result = await syncConnection(db, client, connection, getModel());
    await refreshInsights(db);
    return redirect(`/banken?verbunden=${result.inserted}`, { headers: clear });
  } catch (error) {
    console.error(`Bankverbindung nicht abgeschlossen: ${safeError(error)}`);
    return redirect("/banken?fehler=fehler", { headers: clear });
  }
}
