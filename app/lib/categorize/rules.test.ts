import { describe, expect, it } from "vitest";
import { firstMatchingRule, ruleInputSchema, ruleMatches, slowRegex } from "./rules";

const tx = { counterparty: "PayPal Europe", purpose: "PP.4471.PP . Thomann GmbH, Ihr Einkauf bei Thomann" };
const rule = (overrides: object) => ({
  field: "counterparty" as const,
  matchType: "contains" as const,
  pattern: "x",
  priority: 0,
  createdAt: new Date("2026-01-01"),
  categoryId: "c",
  ...overrides,
});

describe("ruleMatches", () => {
  it("contains ignoriert Groß- und Kleinschreibung", () => {
    expect(ruleMatches(rule({ field: "purpose", pattern: "THOMANN" }), tx)).toBe(true);
  });
  it("equals braucht den ganzen Wert", () => {
    expect(ruleMatches(rule({ matchType: "equals", pattern: "paypal europe" }), tx)).toBe(true);
    expect(ruleMatches(rule({ matchType: "equals", pattern: "paypal" }), tx)).toBe(false);
  });
  it("regex", () => {
    expect(ruleMatches(rule({ field: "purpose", matchType: "regex", pattern: "thomann\\s+gmbh" }), tx)).toBe(true);
  });
  it("ein kaputter gespeicherter Regex trifft nichts statt abzustürzen", () => {
    expect(ruleMatches(rule({ matchType: "regex", pattern: "(" }), tx)).toBe(false);
  });
});

describe("firstMatchingRule", () => {
  it("höhere Priorität schlägt niedrigere, egal in welcher Reihenfolge sie kommen", () => {
    const low = rule({ pattern: "paypal", priority: 0, categoryId: "low" });
    const high = rule({ field: "purpose", pattern: "thomann", priority: 10, categoryId: "high" });
    expect(firstMatchingRule([low, high], tx)?.categoryId).toBe("high");
    expect(firstMatchingRule([high, low], tx)?.categoryId).toBe("high");
  });
  it("bei gleicher Priorität gewinnt die ältere Regel", () => {
    const older = rule({ pattern: "paypal", createdAt: new Date("2026-01-01"), categoryId: "older" });
    const newer = rule({ pattern: "pal", createdAt: new Date("2026-02-01"), categoryId: "newer" });
    expect(firstMatchingRule([newer, older], tx)?.categoryId).toBe("older");
  });
  it("ohne Treffer undefined", () => {
    expect(firstMatchingRule([rule({ pattern: "rewe" })], tx)).toBeUndefined();
  });
});

describe("ruleInputSchema", () => {
  const valid = { field: "counterparty", matchType: "regex", pattern: "a+", categoryId: crypto.randomUUID() };
  it("akzeptiert gültige Eingaben und setzt Priorität 0", () => {
    expect(ruleInputSchema.parse(valid).priority).toBe(0);
  });
  it("lehnt ungültigen Regex mit Hinweis ab", () => {
    const result = ruleInputSchema.safeParse({ ...valid, pattern: "(" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Ungültiger regulärer Ausdruck");
  });
  it("lehnt leeres Muster ab", () => {
    expect(ruleInputSchema.safeParse({ ...valid, pattern: "  " }).success).toBe(false);
  });
});

describe("langsame reguläre Ausdrücke (ReDoS)", () => {
  it.each(["(a+)+$", "(\\w+\\s?)*$", "(a|aa)+$", "(foo|fo)*x", "(.*a){12}", "(x+x+)+y", "(a)\\1+"])(
    "%s wird beim Speichern abgelehnt",
    (pattern) => {
      expect(slowRegex(pattern)).toBe(true);
    },
  );

  it.each(["rewe|edeka", "^amazon", "(netflix|disney)", "\\d{4}", "lidl.*filiale", "(abo)?nnement"])(
    "%s bleibt erlaubt",
    (pattern) => {
      expect(slowRegex(pattern)).toBe(false);
    },
  );

  it("eine schon gespeicherte langsame Regel wird übersprungen, statt den Import hängen zu lassen", () => {
    const started = performance.now();
    const hit = ruleMatches(
      { field: "purpose", matchType: "regex", pattern: "(a|aa)+$" },
      { counterparty: "", purpose: `${"a".repeat(60)}!` },
    );
    expect(hit).toBe(false);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
