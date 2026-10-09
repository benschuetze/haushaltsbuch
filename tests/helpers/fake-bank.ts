import { createVerify, generateKeyPairSync } from "node:crypto";

/** A stand-in for the Enable Banking API: same routes, real RS256 check, scripted data. */
export function createFakeBank(options: { appId: string; publicKey: string }) {
  const sessions = new Map<string, { revoked: boolean }>();
  let codes = 0;
  const state = { expireSessions: false, calls: [] as string[] };

  const transactions = {
    first: [
      tx("2026-10-01", "DBIT", "890.00", "Hausverwaltung Sonnenhof", "Miete 10/2026"),
      tx("2026-10-02", "CRDT", "3612.40", "Arbeitgeber Muster GmbH", "Gehalt 10/2026", "debtor"),
      tx("2026-10-04", "DBIT", "63.12", "REWE Markt", "Kartenzahlung DE89370400440532013000"),
    ],
    second: [
      tx("2026-10-05", "DBIT", "10.99", "Spotify AB", "Spotify Premium"),
      { ...tx("2026-10-08", "DBIT", "24.00", "Zoo Beispielstadt", "Eintritt"), status: "PDNG" },
    ],
  };

  function authorized(req: Request): boolean {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const [h, b, s] = token.split(".");
    if (!h || !b || !s) return false;
    const header = JSON.parse(Buffer.from(h, "base64url").toString()) as { alg?: string; kid?: string };
    const body = JSON.parse(Buffer.from(b, "base64url").toString()) as { exp?: number; aud?: string };
    if (header.alg !== "RS256" || header.kid !== options.appId || body.aud !== "api.enablebanking.com") return false;
    if (!body.exp || body.exp * 1000 < Date.now()) return false;
    return createVerify("RSA-SHA256").update(`${h}.${b}`).verify(options.publicKey, s, "base64url");
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    state.calls.push(`${req.method} ${url.pathname}`);
    if (!authorized(req)) return json({ error: "UNAUTHORIZED", message: "JWT invalid" }, 401);
    if (req.method === "GET" && url.pathname === "/aspsps") {
      return json({
        aspsps: [{ name: "Testbank", country: "DE", psu_types: ["personal"], maximum_consent_validity: 15552000 }],
      });
    }
    if (req.method === "POST" && url.pathname === "/auth") {
      const body = (await req.json()) as { state: string; redirect_url: string; aspsp: { name: string } };
      codes++;
      const target = new URL(body.redirect_url);
      target.searchParams.set("state", body.state);
      target.searchParams.set("code", `code-${codes}`);
      return json({ url: target.toString(), authorization_id: `auth-${codes}` });
    }
    if (req.method === "POST" && url.pathname === "/sessions") {
      const { code } = (await req.json()) as { code: string };
      if (!code.startsWith("code-")) return json({ error: "WRONG_CODE" }, 400);
      const id = `sess-${code}`;
      sessions.set(id, { revoked: false });
      return json({
        session_id: id,
        accounts: [
          { uid: "acc-1", account_id: { iban: "DE00 1234 5678 9012 3456 78" }, name: "Girokonto", currency: "EUR" },
        ],
        access: { valid_until: new Date(Date.now() + 180 * 86_400_000).toISOString() },
      });
    }
    const txMatch = /^\/accounts\/([^/]+)\/transactions$/.exec(url.pathname);
    if (req.method === "GET" && txMatch) {
      if (state.expireSessions) return json({ error: "EXPIRED_SESSION", message: "Session expired" }, 401);
      const page = url.searchParams.get("continuation_key");
      return page === "p2"
        ? json({ transactions: transactions.second, continuation_key: null })
        : json({ transactions: transactions.first, continuation_key: "p2" });
    }
    const delMatch = /^\/sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === "DELETE" && delMatch) {
      const s = sessions.get(decodeURIComponent(delMatch[1] ?? ""));
      if (s) s.revoked = true;
      return json({});
    }
    return json({ error: "NOT_FOUND" }, 404);
  }

  return {
    handle,
    state,
    sessions,
    fetch: (input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init)),
  };
}

function tx(
  date: string,
  cd: "CRDT" | "DBIT",
  amount: string,
  name: string,
  purpose: string,
  side: "creditor" | "debtor" = "creditor",
) {
  return {
    transaction_amount: { amount, currency: "EUR" },
    credit_debit_indicator: cd,
    status: "BOOK",
    booking_date: date,
    value_date: date,
    [side]: { name },
    [side === "creditor" ? "debtor" : "creditor"]: { name: "Alex Beispiel" },
    remittance_information: [purpose],
    entry_reference: `ref-${date}-${name}`,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Throwaway key pair for tests; never the real one. */
export function testKeys() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
