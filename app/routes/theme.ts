import { data, redirect } from "react-router";
import { safeRedirect } from "~/lib/auth.server";
import { themeCookie, themeSchema } from "~/lib/theme.server";
import type { Route } from "./+types/theme";

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const theme = themeSchema.safeParse(form.get("theme"));
  if (!theme.success) return data({ ok: false }, { status: 400 });
  return redirect(safeRedirect(String(form.get("back") ?? "/")), {
    headers: { "Set-Cookie": await themeCookie.serialize(theme.data) },
  });
}

export function loader() {
  return redirect("/");
}
