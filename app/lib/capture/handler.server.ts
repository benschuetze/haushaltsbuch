import { createHash, timingSafeEqual } from "node:crypto";
import type { LanguageModel } from "ai";
import { isDemo } from "~/lib/auth.server";
import type { Db } from "~/lib/db/client";
import { isLoginBlocked, recordFailedLogin } from "~/lib/login-throttle.server";
import { log } from "~/lib/observability/log.server";
import { clientIp, hashIp } from "~/lib/security.server";
import { type CaptureResult, captureInputSchema, captureSpoken } from "./run";

const MIN_TOKEN_LENGTH = 32;
/** A sentence is at most 500 characters; the rest of the body is a key and some JSON. */
const MAX_BODY_BYTES = 4096;

function reply(body: Record<string, unknown>, status: number, headers?: HeadersInit): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** Hashing first makes both sides the same length, which timingSafeEqual requires, without leaking the length. */
function tokenMatches(request: Request, token: string): boolean {
  const given = request.headers.get("authorization") ?? "";
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(`Bearer ${token}`).digest();
  return timingSafeEqual(a, b);
}

/** What the caller needs to show "booked 7,00 € Döner"; never the stored sentence or anything about other rows. */
function bookingBody({ created, transaction: tx, categoryName, draft }: CaptureResult) {
  return {
    id: tx.id,
    created,
    draft,
    account: "Bar",
    bookingDate: tx.bookingDate,
    amountCents: tx.amountCents,
    counterparty: tx.counterparty,
    category: categoryName,
    needsReview: tx.needsReview,
  };
}

/**
 * POST /api/capture with `Authorization: Bearer $CAPTURE_TOKEN` and `{ text, key }`. Outside the login session on
 * purpose (an iOS Shortcut has no cookie), so it carries its own gate: demo refuses, a missing or weak token switches
 * the endpoint off, wrong tokens count towards the same lockout as wrong passwords.
 */
export async function handleCapture(
  request: Request,
  deps: { db: Db; model: LanguageModel | null; now?: Date },
): Promise<Response> {
  // Bookings in the demo would be wiped by the nightly reset and are visible to everyone.
  if (isDemo()) return reply({ error: "Die Demo ist schreibgeschützt." }, 403);

  const token = process.env.CAPTURE_TOKEN;
  if (!token || token.length < MIN_TOKEN_LENGTH)
    return reply({ error: "Schnellerfassung ist nicht eingerichtet." }, 503);

  // Own namespace per address, but the shared window and global cap of the login throttle.
  const ipHash = hashIp(`capture:${clientIp(request)}`);
  if (await isLoginBlocked(deps.db, ipHash, deps.now)) {
    return reply({ error: "Zu viele Fehlversuche, bitte später erneut." }, 429, { "retry-after": "900" });
  }
  if (!tokenMatches(request, token)) {
    // Only a wrong Bearer token counts as a guess. This path is exempt from the cross-site check, so any foreign page
    // can POST here without a header; counting those would let it fill the shared cap and lock the owner out. A
    // browser cannot send an Authorization header cross-site without a preflight, so this needs a real client.
    if (request.headers.get("authorization")?.startsWith("Bearer ")) {
      await recordFailedLogin(deps.db, ipHash, deps.now);
    }
    return reply({ error: "Nicht autorisiert." }, 401, { "www-authenticate": "Bearer" });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return reply({ error: "Anfrage zu groß." }, 413);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return reply({ error: "Der Body muss JSON sein: { text, key }." }, 400);
  }
  const parsed = captureInputSchema.safeParse(json);
  if (!parsed.success) return reply({ error: parsed.error.issues[0]?.message ?? "Ungültige Anfrage." }, 400);

  const result = await captureSpoken(deps.db, parsed.data, { model: deps.model, now: deps.now });
  // Ids and flags only: the sentence is personal text and stays out of the logs.
  log.info(
    { event: "capture_booked", id: result.transaction.id, created: result.created, draft: result.draft },
    "Schnellerfassung gebucht",
  );
  return reply(bookingBody(result), result.created ? 201 : 200);
}
