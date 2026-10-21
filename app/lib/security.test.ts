import { afterEach, describe, expect, it, vi } from "vitest";
import { hasNestedQuantifier, ruleInputSchema } from "~/lib/categorize/rules";
import { decryptSecret, encryptSecret } from "./crypto.server";
import { applySecurityHeaders, contentSecurityPolicy, hashIp, isCrossSiteWrite, safeError } from "./security.server";

afterEach(() => vi.unstubAllEnvs());

const post = (headers: Record<string, string>) =>
  new Request("https://app.example/import", { method: "POST", headers });

describe("CSRF: isCrossSiteWrite", () => {
  it("lässt Lesezugriffe immer durch", () => {
    expect(isCrossSiteWrite(new Request("https://app.example/", { headers: { "Sec-Fetch-Site": "cross-site" } }))).toBe(
      false,
    );
  });
  it.each([
    [{ "Sec-Fetch-Site": "same-origin" }, false],
    [{ "Sec-Fetch-Site": "none" }, false],
    [{ "Sec-Fetch-Site": "cross-site" }, true],
    [{ "Sec-Fetch-Site": "same-site" }, true],
    [{ Origin: "https://app.example" }, false],
    [{ Origin: "https://evil.example" }, true],
    [{ Origin: "https://app.example.evil.example" }, true],
    [{ Origin: "null" }, true],
    [{ Referer: "https://app.example/import" }, false],
    [{ Referer: "https://evil.example/app.example" }, true],
    [{ Referer: "kaputt" }, true],
    [{}, true],
  ])("%j → abgelehnt: %s", (headers, rejected) => {
    expect(isCrossSiteWrite(post(headers as Record<string, string>))).toBe(rejected);
  });
  it("/api/capture ist ausgenommen (Bearer-Token, kein Cookie), andere Pfade nicht", () => {
    const bare = (path: string) => new Request(`https://app.example${path}`, { method: "POST" });
    expect(isCrossSiteWrite(bare("/api/capture"))).toBe(false);
    expect(isCrossSiteWrite(bare("/api/capture-x"))).toBe(true);
    expect(isCrossSiteWrite(bare("/import"))).toBe(true);
  });
  it("Fetch Metadata hat Vorrang vor einem passenden Origin", () => {
    expect(isCrossSiteWrite(post({ "Sec-Fetch-Site": "cross-site", Origin: "https://app.example" }))).toBe(true);
  });
});

describe("Header", () => {
  it("setzt die Schutz-Header", () => {
    const h = new Headers();
    applySecurityHeaders(h);
    expect(h.get("Strict-Transport-Security")).toContain("max-age=63072000");
    expect(h.get("X-Frame-Options")).toBe("DENY");
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
    expect(h.get("Referrer-Policy")).toBe("no-referrer");
    expect(h.get("X-Robots-Tag")).toContain("noindex");
  });
  it("CSP erlaubt nur Skripte mit Nonce und verbietet Einbetten", () => {
    const csp = contentSecurityPolicy("abc");
    expect(csp).toContain("script-src 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-inline");
  });
  it("CSP lässt Daten nur zum eigenen Server: keine fremden Verbindungen, Bilder, Schriften oder Frames", () => {
    const csp = contentSecurityPolicy("abc");
    // Injected markup could otherwise send data out through an image URL or a fetch to another host.
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("worker-src 'self'");
    expect(csp).toContain("manifest-src 'self'");
    expect(csp).toContain("media-src 'self'");
  });
});

describe("Logs ohne Kontodaten", () => {
  it("safeError lässt den Anfragetext eines KI-Fehlers weg", () => {
    const apiError = Object.assign(new Error("Bad Request"), {
      name: "AI_APICallError",
      statusCode: 400,
      responseBody: '{"error":"invalid_request_error"}',
      requestBodyValues: { messages: [{ content: "REWE Markt Kartenzahlung -45.10 DE89370400440532013000" }] },
    });
    const logged = safeError(apiError);
    expect(logged).toBe('AI_APICallError · HTTP 400 · Bad Request · Antwort: {"error":"invalid_request_error"}');
    expect(logged).not.toMatch(/REWE|DE89|45\.10/);
  });
});

describe("IP-Hash", () => {
  it("speichert keine IP im Klartext und hängt vom Secret ab", () => {
    vi.stubEnv("SESSION_SECRET", "a".repeat(32));
    const a = hashIp("203.0.113.7");
    expect(a).not.toContain("203.0.113.7");
    vi.stubEnv("SESSION_SECRET", "b".repeat(32));
    expect(hashIp("203.0.113.7")).not.toBe(a);
  });
});

describe("ReDoS", () => {
  it.each(["(a+)+", "(\\w*)*x", "(.*a){10}", "([a-z]+)*$"])("lehnt %s ab", (p) => {
    expect(hasNestedQuantifier(p)).toBe(true);
  });
  it.each(["thomann\\s+gmbh", "^rewe", "(rewe|lidl)", "amazon.*prime", "a{2,3}"])("erlaubt %s", (p) => {
    expect(hasNestedQuantifier(p)).toBe(false);
  });
  it("Regel mit gefährlichem Muster wird mit Erklärung abgelehnt", () => {
    const r = ruleInputSchema.safeParse({
      field: "purpose",
      matchType: "regex",
      pattern: "(a+)+",
      categoryId: crypto.randomUUID(),
    });
    expect(r.error?.issues[0]?.message).toMatch(/sehr langsam/);
  });
});

describe("Verschlüsselung", () => {
  const KEY = Buffer.alloc(32, 7).toString("base64");

  it("verschlüsselt und entschlüsselt, jedes Mal mit anderem Geheimtext", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY);
    const a = encryptSecret("session-123");
    const b = encryptSecret("session-123");
    expect(a).not.toBe(b);
    expect(a).not.toContain("session-123");
    expect(decryptSecret(a)).toBe("session-123");
  });

  it("veränderter Geheimtext fällt auf, statt Unsinn zu liefern", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY);
    const [v, iv, tag, data] = encryptSecret("session-123").split(":");
    const flipped = Buffer.from(data ?? "", "base64");
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => decryptSecret([v, iv, tag, flipped.toString("base64")].join(":"))).toThrow();
  });

  it("falscher Schlüssel entschlüsselt nicht", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", KEY);
    const stored = encryptSecret("session-123");
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("ohne gültigen Schlüssel klarer Fehler statt unverschlüsselt zu speichern", () => {
    vi.stubEnv("DATA_ENCRYPTION_KEY", "");
    expect(() => encryptSecret("x")).toThrow(/DATA_ENCRYPTION_KEY/);
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(16).toString("base64"));
    expect(() => encryptSecret("x")).toThrow(/32-Byte/);
  });
});
