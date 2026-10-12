import { redirect } from "react-router";
import type { Route } from "./+types/transaktionen-alt";

/** The list used to live at /transaktionen; the menu has always said "Buchungen". Old links keep working. */
export function loader({ request }: Route.LoaderArgs) {
  return redirect(`/buchungen${new URL(request.url).search}`, 301);
}
