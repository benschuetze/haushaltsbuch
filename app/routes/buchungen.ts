import { redirect } from "react-router";
import type { Route } from "./+types/buchungen";

/** The menu says "Buchungen", the page lives at /transaktionen: the obvious address should work too. */
export function loader({ request }: Route.LoaderArgs) {
  return redirect(`/transaktionen${new URL(request.url).search}`, 301);
}
