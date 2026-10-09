import { createCookie } from "react-router";
import { cookieSecret } from "~/lib/auth.server";

/**
 * Binds the redirect to this browser: the bank sends the user back with `state` in the URL, and only the
 * browser that started the flow has the matching cookie. Lax, because the return is a top-level navigation.
 */
export function bankStateCookie() {
  return createCookie("hb_bank_state", {
    httpOnly: true,
    sameSite: "lax",
    path: "/bank",
    maxAge: 15 * 60,
    secure: process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "1",
    secrets: [cookieSecret()],
  });
}
