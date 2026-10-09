/**
 * Where each service lets you cancel. These pages refuse to be embedded (X-Frame-Options), so the app opens
 * them in their own window and reads the outcome from later bookings instead.
 * Checked by hand on 2026-10-09; a 403 from a bot check is fine, a 404 is not.
 */
export const CANCEL_LINKS: { match: RegExp; url: string }[] = [
  { match: /netflix/, url: "https://www.netflix.com/cancelplan" },
  { match: /spotify/, url: "https://www.spotify.com/de/account/subscription/" },
  { match: /disney/, url: "https://www.disneyplus.com/account/subscription" },
  { match: /amazon prime|prime video|amzn prime/, url: "https://www.amazon.de/gp/primecentral" },
  { match: /audible/, url: "https://www.audible.de/account/overview" },
  { match: /apple|itunes|icloud/, url: "https://apps.apple.com/account/subscriptions" },
  { match: /google|youtube/, url: "https://play.google.com/store/account/subscriptions" },
  { match: /\bdazn\b/, url: "https://www.dazn.com/de-DE/myaccount" },
  { match: /\bsky\b/, url: "https://www.sky.de/kuendigung" },
  { match: /\brtl\b/, url: "https://plus.rtl.de/mein-konto" },
  { match: /joyn/, url: "https://www.joyn.de/mein-account" },
  { match: /deezer/, url: "https://www.deezer.com/account/subscription" },
  { match: /tidal/, url: "https://account.tidal.com/subscription" },
  { match: /microsoft|xbox|office 365/, url: "https://account.microsoft.com/services" },
  { match: /adobe/, url: "https://account.adobe.com/plans" },
  { match: /dropbox/, url: "https://www.dropbox.com/account/plan" },
  { match: /openai|chatgpt/, url: "https://chatgpt.com/#settings/Subscription" },
  { match: /anthropic|claude/, url: "https://claude.ai/settings/billing" },
  {
    match: /playstation|sony interactive/,
    url: "https://www.playstation.com/de-de/support/subscriptions/cancel-playstation-plus/",
  },
  { match: /bookbeat/, url: "https://www.bookbeat.com/de/account" },
  { match: /linkedin/, url: "https://www.linkedin.com/premium/manage/" },
  { match: /patreon/, url: "https://www.patreon.com/settings/memberships" },
  { match: /urban sports/, url: "https://urbansportsclub.com/de/profile/membership" },
];

export type CancelLink = { url: string; direct: boolean };

/**
 * Known services go straight to their cancel page. For everything else a search for the provider's
 * cancel button: since 2022 every German online contract must have one ("Verträge hier kündigen").
 */
export function cancelLinkFor(merchant: string): CancelLink {
  const text = merchant.toLowerCase();
  const known = CANCEL_LINKS.find((l) => l.match.test(text));
  if (known) return { url: known.url, direct: true };
  return {
    url: `https://duckduckgo.com/?q=${encodeURIComponent(`${merchant} Vertrag kündigen`)}`,
    direct: false,
  };
}
