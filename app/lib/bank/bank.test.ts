import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "~/lib/db/client";
import { accounts, bankAccounts, bankAuthStates, bankConnections, transactions } from "~/lib/db/schema";
import { createTestDb } from "../../../tests/helpers/db";
import { createFakeBank, testKeys } from "../../../tests/helpers/fake-bank";
import { bankConfig, bankRedirectAllowed, EnableBankingClient, signJwt } from "./enable-banking.server";
import {
  completeConnection,
  consumeAuthState,
  createAuthState,
  disconnect,
  mapTransaction,
  syncAll,
  syncConnection,
} from "./sync.server";

const keys = testKeys();
const APP = "11111111-2222-3333-4444-555555555555";
let db: Db;
let bank: ReturnType<typeof createFakeBank>;
let client: EnableBankingClient;

beforeEach(async () => {
  ({ db } = await createTestDb());
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  bank = createFakeBank({ appId: APP, publicKey: keys.publicKeyPem });
  client = new EnableBankingClient(
    { appId: APP, privateKey: keys.privateKeyPem, apiUrl: "https://fake.bank" },
    bank.fetch,
  );
});
afterEach(() => vi.unstubAllEnvs());

async function connect() {
  const { state } = await createAuthState(db, { name: "Testbank", country: "DE" });
  const auth = await client.startAuth({
    aspsp: { name: "Testbank", country: "DE" },
    state,
    redirectUrl: "https://app.example/bank/callback",
    validUntil: new Date(Date.now() + 86_400_000),
  });
  const back = new URL(auth.url);
  const aspsp = await consumeAuthState(db, back.searchParams.get("state"), state);
  if (!aspsp) throw new Error("state abgelehnt");
  return completeConnection(db, client, aspsp, back.searchParams.get("code") ?? "");
}

describe("Konfiguration und JWT", () => {
  it("ohne App-ID oder Schlüssel ist die Bankanbindung aus", () => {
    vi.stubEnv("ENABLE_BANKING_APP_ID", "");
    expect(bankConfig()).toBeNull();
  });
  it("nimmt den Schlüssel als PEM oder als base64-Zeile", () => {
    vi.stubEnv("ENABLE_BANKING_APP_ID", APP);
    vi.stubEnv("ENABLE_BANKING_PRIVATE_KEY", Buffer.from(keys.privateKeyPem).toString("base64"));
    expect(bankConfig()?.privateKey).toBe(keys.privateKeyPem);
  });
  it("JWT ist kurzlebig und trägt die App-ID", () => {
    const [h, b] = signJwt({ appId: APP, privateKey: keys.privateKeyPem, apiUrl: "" }, 1_000_000_000_000).split(".");
    expect(JSON.parse(Buffer.from(h ?? "", "base64url").toString())).toMatchObject({ alg: "RS256", kid: APP });
    const body = JSON.parse(Buffer.from(b ?? "", "base64url").toString());
    expect(body.exp - body.iat).toBeLessThanOrEqual(600);
  });
  it("die Fake-Bank lehnt eine falsche Signatur ab", async () => {
    const other = testKeys();
    const wrong = new EnableBankingClient(
      { appId: APP, privateKey: other.privateKeyPem, apiUrl: "https://fake.bank" },
      bank.fetch,
    );
    await expect(wrong.listAspsps("DE")).rejects.toMatchObject({ status: 401 });
  });
});

describe("Rücksprung von der Bank (state)", () => {
  it("nur einmal gültig", async () => {
    const { state } = await createAuthState(db, { name: "Testbank", country: "DE" });
    expect(await consumeAuthState(db, state, state)).toEqual({ name: "Testbank", country: "DE" });
    expect(await consumeAuthState(db, state, state)).toBeNull();
  });
  it("muss zum Cookie dieses Browsers passen", async () => {
    const { state } = await createAuthState(db, { name: "Testbank", country: "DE" });
    expect(await consumeAuthState(db, state, "anderer-state")).toBeNull();
    expect(await consumeAuthState(db, state, null)).toBeNull();
  });
  it("verfällt nach 15 Minuten", async () => {
    const t0 = new Date("2026-10-09T10:00:00Z");
    const { state } = await createAuthState(db, { name: "Testbank", country: "DE" }, t0);
    expect(await consumeAuthState(db, state, state, new Date(t0.getTime() + 16 * 60_000))).toBeNull();
  });
  it("in der Datenbank steht nur der Hash", async () => {
    const { state } = await createAuthState(db, { name: "Testbank", country: "DE" });
    const rows = await db.select().from(bankAuthStates);
    expect(JSON.stringify(rows)).not.toContain(state);
  });
});

describe("Verbinden und Abrufen", () => {
  it("Session nur verschlüsselt gespeichert, Konto über IBAN angelegt", async () => {
    const connection = await connect();
    expect(connection.sessionIdEncrypted).toMatch(/^v1:/);
    expect(connection.sessionIdEncrypted).not.toContain("sess-");
    const [link] = await db.select().from(bankAccounts);
    expect(link).toMatchObject({ accountUid: "acc-1", ibanTail: "5678" });
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, link?.accountId ?? ""));
    expect(account?.name).toBe("Testbank ··5678");
  });

  it("holt alle Seiten, Vorzeichen stimmen, vorgemerkte werden übersprungen", async () => {
    const connection = await connect();
    const result = await syncConnection(db, client, connection, null);
    expect(result).toMatchObject({ inserted: 4, duplicates: 0, skipped: 1, rejected: 0 });
    const rows = await db.select().from(transactions);
    expect(rows.find((r) => r.counterparty === "Hausverwaltung Sonnenhof")?.amountCents).toBe(-89000);
    expect(rows.find((r) => r.counterparty === "Arbeitgeber Muster GmbH")?.amountCents).toBe(361240);
    expect(bank.state.calls.filter((c) => c.includes("/transactions"))).toHaveLength(2);
  });

  it("zweiter Abruf: nichts doppelt", async () => {
    const connection = await connect();
    await syncConnection(db, client, connection, null);
    const [fresh] = await db.select().from(bankConnections);
    const again = await syncConnection(db, client, fresh ?? connection, null);
    expect(again).toMatchObject({ inserted: 0, duplicates: 4 });
    expect(await db.$count(transactions)).toBe(4);
  });

  it("Zugang von der Bank widerrufen: Verbindung wird als abgelaufen markiert, ohne Daten im Fehlertext", async () => {
    const connection = await connect();
    bank.state.expireSessions = true;
    const result = await syncConnection(db, client, connection, null);
    expect(result.error).toBe("Zugang abgelaufen oder widerrufen");
    const [after] = await db.select().from(bankConnections);
    expect(after?.status).toBe("expired");
    expect(after?.lastError).toContain("EXPIRED_SESSION");
    expect(await syncAll(db, client, null)).toEqual([]);
  });

  it("abgelaufenes Datum: kein Aufruf bei der Bank", async () => {
    const connection = await connect();
    const calls = bank.state.calls.length;
    const result = await syncConnection(db, client, { ...connection, validUntil: new Date(Date.now() - 1000) }, null);
    expect(result.error).toBe("Zugang abgelaufen");
    expect(bank.state.calls.length).toBe(calls);
  });

  it("Trennen widerruft bei der Bank und löscht das Geheimnis, Buchungen bleiben", async () => {
    const connection = await connect();
    await syncConnection(db, client, connection, null);
    await disconnect(db, client, connection.id);
    const [after] = await db.select().from(bankConnections);
    expect(after).toMatchObject({ status: "revoked", sessionIdEncrypted: "" });
    expect([...bank.sessions.values()][0]?.revoked).toBe(true);
    expect(await db.$count(transactions)).toBe(4);
  });
});

describe("mapTransaction", () => {
  it("IBAN im Verwendungszweck bleibt im Datensatz, geht aber nicht als Gegenpartei durch", () => {
    const m = mapTransaction({
      transaction_amount: { amount: "12.50", currency: "EUR" },
      credit_debit_indicator: "DBIT",
      status: "BOOK",
      booking_date: "2026-10-01",
      creditor: { name: "Bäckerei" },
      remittance_information: ["Brötchen", "Danke"],
    });
    expect(m).toMatchObject({ row: { amountCents: -1250, counterparty: "Bäckerei", purpose: "Brötchen Danke" } });
  });
  it("unbekanntes Format wird abgelehnt statt geraten", () => {
    expect(mapTransaction({ foo: 1 })).toEqual({ reject: "Buchung in unerwartetem Format" });
  });
});

describe("echte API-Antworten", () => {
  it("Konto ohne IBAN (account_id: null, wie die Sandbox es liefert) wird trotzdem verbunden", async () => {
    const realistic = async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      if (new URL(req.url).pathname === "/sessions") {
        return new Response(
          JSON.stringify({
            session_id: "sess-real",
            accounts: [{ uid: "acc-null", account_id: null, name: null, currency: "EUR", details: null }],
            aspsp: { name: "Mock ASPSP", country: "DE" },
            psu_type: "personal",
            access: { valid_until: "2027-04-07T10:19:29.444000+00:00", balances: true, transactions: true },
          }),
          { status: 200 },
        );
      }
      return bank.fetch(input, init);
    };
    const c = new EnableBankingClient(
      { appId: APP, privateKey: keys.privateKeyPem, apiUrl: "https://fake.bank" },
      realistic,
    );
    const connection = await completeConnection(db, c, { name: "Mock ASPSP", country: "DE" }, "code-x");
    expect(connection.validUntil.toISOString()).toBe("2027-04-07T10:19:29.444Z");
    const [link] = await db.select().from(bankAccounts);
    expect(link).toMatchObject({ accountUid: "acc-null", ibanTail: null });
  });
});

describe("Weiterleitung zur Bank", () => {
  it.each([
    ["https://auth.bank.example/start?x=1", true],
    ["http://127.0.0.1:5199/bank/callback", true],
    ["http://bank.example/login", false],
    ["javascript:alert(1)", false],
    ["data:text/html,hi", false],
    ["kein link", false],
  ])("%s → %s", (url, allowed) => {
    expect(bankRedirectAllowed(url)).toBe(allowed);
  });
});
