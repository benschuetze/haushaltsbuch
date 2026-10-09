import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBank, testKeys } from "../../../tests/helpers/fake-bank";
import { EnableBankingClient } from "./enable-banking.server";
import { bankSmokeTest } from "./smoke";

const APP = "app-selbsttest";
const keys = testKeys();
const bank = createFakeBank({ appId: APP, publicKey: keys.publicKeyPem });
const client = (privateKey = keys.privateKeyPem) =>
  new EnableBankingClient({ appId: APP, privateKey, apiUrl: "https://fake.bank" }, bank.fetch);

beforeEach(() => {
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  bank.state.inactive = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("Bank-Selbsttest beim Deploy", () => {
  it("richtiger Schlüssel: bestanden, mit Zahl der Banken", async () => {
    expect(await bankSmokeTest(client())).toEqual({ problems: [], warnings: [], banks: 4 });
  });

  it("Schlüssel passt nicht zur App-ID (so ist es live passiert): klarer Fehler, Build stoppt", async () => {
    const result = await bankSmokeTest(client(testKeys().privateKeyPem));
    expect(result.problems).toEqual([
      "Enable Banking lehnt die Signatur ab (401): ENABLE_BANKING_PRIVATE_KEY passt nicht zu ENABLE_BANKING_APP_ID.",
    ]);
  });

  it("App registriert, aber noch nicht aktiviert: nur ein Hinweis, kein Abbruch", async () => {
    bank.state.inactive = true;
    const result = await bankSmokeTest(client());
    expect(result.problems).toEqual([]);
    expect(result.warnings[0]).toContain("noch nicht aktiviert");
  });

  it("Verschlüsselungsschlüssel als Hex statt base64: Fehler, bevor die erste Verbindung daran scheitert", async () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", "ab".repeat(32));
    const result = await bankSmokeTest(client());
    expect(result.problems.join()).toContain("DATA_ENCRYPTION_KEY unbrauchbar");
  });
});
