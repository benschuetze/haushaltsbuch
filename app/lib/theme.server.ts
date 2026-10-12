import { createCookie } from "react-router";
import { z } from "zod";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const themeSchema = z.enum(THEMES);

/**
 * The choice lives in a cookie, not in localStorage: the server writes data-theme into the HTML it sends, so the
 * page never flashes light before switching to dark.
 */
export const themeCookie = createCookie("theme", {
  path: "/",
  sameSite: "lax",
  httpOnly: true,
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
});

export async function readTheme(request: Request): Promise<Theme> {
  const parsed = themeSchema.safeParse(await themeCookie.parse(request.headers.get("Cookie")));
  return parsed.success ? parsed.data : "system";
}
