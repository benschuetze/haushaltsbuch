import { createSign } from "node:crypto";
import { z } from "zod";

export type BankConfig = { appId: string; privateKey: string; apiUrl: string };

/** null when the bank connection is not set up (demo, previews, local without keys). */
export function bankConfig(): BankConfig | null {
  const appId = process.env.ENABLE_BANKING_APP_ID?.trim();
  const raw = process.env.ENABLE_BANKING_PRIVATE_KEY?.trim();
  if (!appId || !raw) return null;
  // Accepted as PEM or as one base64 line, because multi-line values are easy to break when pasting.
  const privateKey = raw.startsWith("-----BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return { appId, privateKey, apiUrl: process.env.ENABLE_BANKING_API_URL?.trim() || "https://api.enablebanking.com" };
}

/** RS256 token as the API expects it; short lived, so a leaked token is useless within minutes. */
export function signJwt(config: BankConfig, now = Date.now()): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const iat = Math.floor(now / 1000);
  const head = enc({ typ: "JWT", alg: "RS256", kid: config.appId });
  const body = enc({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat, exp: iat + 600 });
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(config.privateKey, "base64url");
  return `${head}.${body}.${sig}`;
}

export class BankApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = "BankApiError";
  }
  /** The bank or the user withdrew access, or it ran out: the user must connect again. */
  get needsReconsent(): boolean {
    return (
      this.status === 401 || this.status === 403 || /EXPIRED|REVOKED|CLOSED|INVALID_SESSION/i.test(this.code ?? "")
    );
  }
}

const aspspSchema = z.object({
  name: z.string(),
  country: z.string(),
  psu_types: z.array(z.string()).optional(),
  maximum_consent_validity: z.number().optional(),
});
export type Aspsp = z.infer<typeof aspspSchema>;

const authSchema = z.object({ url: z.string().url(), authorization_id: z.string().optional() });

// Banks fill these very differently; anything optional may also arrive as null (seen in the sandbox).
const sessionSchema = z.object({
  session_id: z.string().min(1),
  accounts: z.array(
    z.object({
      uid: z.string().min(1),
      account_id: z.object({ iban: z.string().nullish() }).partial().nullish(),
      name: z.string().nullish(),
      currency: z.string().nullish(),
    }),
  ),
  access: z.object({ valid_until: z.string().nullish() }).partial().nullish(),
});
export type BankSession = z.infer<typeof sessionSchema>;

const party = z.object({ name: z.string().nullish() }).passthrough().nullish();
export const transactionSchema = z
  .object({
    transaction_amount: z.object({ amount: z.string(), currency: z.string() }),
    credit_debit_indicator: z.enum(["CRDT", "DBIT"]),
    status: z.string().nullish(),
    booking_date: z.string().nullish(),
    value_date: z.string().nullish(),
    transaction_date: z.string().nullish(),
    creditor: party,
    debtor: party,
    remittance_information: z.array(z.string()).nullish(),
    entry_reference: z.string().nullish(),
    transaction_id: z.string().nullish(),
  })
  .passthrough();
export type BankTransaction = z.infer<typeof transactionSchema>;

const transactionsSchema = z.object({
  transactions: z.array(z.unknown()),
  continuation_key: z.string().nullish(),
});

export class EnableBankingClient {
  constructor(
    private readonly config: BankConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(method: string, path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.config.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${signJwt(this.config)}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let code: string | null = null;
      let message = `HTTP ${res.status}`;
      try {
        const err = JSON.parse(text) as { error?: string; code?: string; message?: string };
        code = err.error ?? err.code ?? null;
        message = `${message}${code ? ` ${code}` : ""}${err.message ? `: ${String(err.message).slice(0, 200)}` : ""}`;
      } catch {
        // Non-JSON error bodies are not echoed: they could contain anything.
      }
      throw new BankApiError(res.status, code, message);
    }
    return schema.parse(text ? JSON.parse(text) : {});
  }

  async listAspsps(country: string): Promise<Aspsp[]> {
    const r = await this.request(
      "GET",
      `/aspsps?country=${encodeURIComponent(country)}&psu_type=personal`,
      z.object({ aspsps: z.array(aspspSchema) }),
    );
    return r.aspsps;
  }

  startAuth(input: { aspsp: { name: string; country: string }; state: string; redirectUrl: string; validUntil: Date }) {
    return this.request("POST", "/auth", authSchema, {
      access: { valid_until: input.validUntil.toISOString() },
      aspsp: input.aspsp,
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: "personal",
    });
  }

  createSession(code: string): Promise<BankSession> {
    return this.request("POST", "/sessions", sessionSchema, { code });
  }

  async transactions(accountUid: string, dateFrom: string, continuationKey?: string) {
    const params = new URLSearchParams({ date_from: dateFrom });
    if (continuationKey) params.set("continuation_key", continuationKey);
    const r = await this.request(
      "GET",
      `/accounts/${encodeURIComponent(accountUid)}/transactions?${params}`,
      transactionsSchema,
    );
    return { transactions: r.transactions, continuationKey: r.continuation_key ?? null };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`, z.unknown());
  }
}
