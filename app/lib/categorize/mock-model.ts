import { MockLanguageModelV4 } from "ai/test";

/** Deterministic stand-in for E2E runs and the demo: keyword table instead of a model, unknowns go to review. */
const KEYWORDS: [RegExp, string, number][] = [
  [/gehalt|lohn|gage/i, "Einkommen", 0.95],
  [/kindergeld/i, "Einkommen", 0.9],
  [/miete|hausverwaltung|stadtwerke/i, "Wohnen", 0.92],
  [/rewe|aldi|lidl|edeka|baeckerei|bäckerei/i, "Lebensmittel", 0.93],
  [/kita|kindergarten/i, "Kind & Kita", 0.9],
  [/versicherung/i, "Versicherungen", 0.9],
  [/spotify|anthropic|netflix|telekom/i, "Abos & Verträge", 0.85],
  [/thomann|bandcamp/i, "Hobbys", 0.85],
  [/aral|shell|bahn|tankstelle/i, "Mobilität", 0.88],
  [/apotheke/i, "Gesundheit", 0.85],
  [/zoo|kino/i, "Freizeit", 0.8],
  [/zalando/i, "Kleidung", 0.6],
  [/dm-drogerie|rossmann/i, "Haushalt", 0.65],
  [/tagesgeld|sparrate/i, "Umbuchung", 0.9],
];

// Abbreviations a column-mapping request may contain; anything else stays unmapped.
const COLUMN_HINTS: [RegExp, string][] = [
  [/dt|date|datum/i, "date"],
  [/^amt$|amount|betrag/i, "amount"],
  [/ctpy|partner|empf/i, "counterparty"],
  [/memo|zweck|reference/i, "purpose"],
  [/ccy|currency|währung/i, "currency"],
];

function answerColumnMapping(text: string): string {
  const columns = [...text.matchAll(/^(\d+): (.+)$/gm)].map((m) => ({ index: Number(m[1]), name: m[2] ?? "" }));
  const answer: Record<string, number | string | null> = {
    // Like the real model, which rarely knows a bank from abbreviated column names.
    bank: "Unbekannte Bank",
    date: null,
    amount: null,
    debit: null,
    credit: null,
    counterparty: null,
    payer: null,
    payee: null,
    purpose: null,
    currency: null,
    status: null,
  };
  for (const [pattern, field] of COLUMN_HINTS) {
    const hit = columns.find((c) => pattern.test(c.name));
    if (hit && answer[field] === null) answer[field] = hit.index;
  }
  return JSON.stringify(answer);
}

/** Rule wishes: a known payee plus a keyword makes a rule, anything else is "not understood". */
function answerRuleWish(text: string): string {
  const line = text.split("\n").find((l) => l.includes('"wunsch"')) ?? "{}";
  const { wunsch = "", bekannteEmpfaenger = [] } = JSON.parse(line) as {
    wunsch?: string;
    bekannteEmpfaenger?: string[];
  };
  const payee = bekannteEmpfaenger[0];
  const hit = KEYWORDS.find(([re]) => re.test(`${wunsch} ${payee ?? ""}`));
  if (!payee || !hit) {
    return JSON.stringify({
      understood: false,
      field: "counterparty",
      matchType: "contains",
      patterns: [],
      category: "",
    });
  }
  const pattern = payee.split(/\s+/)[0]?.toLowerCase() ?? payee;
  return JSON.stringify({
    understood: true,
    field: "counterparty",
    matchType: "contains",
    patterns: [pattern],
    category: hit[1],
  });
}

export function createMockModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const text = prompt
        .map((m) =>
          typeof m.content === "string"
            ? m.content
            : m.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"),
        )
        .join("\n");
      if (text.includes('"wunsch"')) {
        return {
          content: [{ type: "text", text: answerRuleWish(text) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 0, text: 0, reasoning: undefined },
          },
          warnings: [],
        };
      }
      if (text.includes("Maskierte Beispielzeilen")) {
        return {
          content: [{ type: "text", text: answerColumnMapping(text) }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 0, text: 0, reasoning: undefined },
          },
          warnings: [],
        };
      }
      const results = text
        .split("\n")
        .filter((line) => line.startsWith("{"))
        .map((line) => {
          const item = JSON.parse(line) as { ref: string; counterparty: string; purpose: string };
          const haystack = `${item.counterparty} ${item.purpose}`;
          const hit = KEYWORDS.find(([re]) => re.test(haystack));
          return { ref: item.ref, category: hit?.[1] ?? "Sonstiges", confidence: hit?.[2] ?? 0.4 };
        });
      return {
        content: [{ type: "text", text: JSON.stringify({ results }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
