import { redirect } from "react-router";
import { logOut } from "~/lib/auth.server";
import type { Route } from "./+types/logout";

export async function action({ request }: Route.ActionArgs) {
  return logOut(request);
}

export function loader() {
  return redirect("/");
}
