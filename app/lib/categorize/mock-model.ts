import { MockLanguageModelV4 } from "ai/test";

/** Deterministic stand-in for E2E runs and the demo: keyword table instead of a model, unknowns go to review. */
const KEYWORDS: [RegExp, string, number][] = [
  [/gehalt|lohn|gage/i, "Einkommen", 0.95],
  [/kindergeld/i, "Einkommen", 0.9],
  [/miete|hausverwaltung|stadtwerke/i, "Wohnen", 0.92],
  [/rewe|aldi|lidl|edeka|baeckerei|bäckerei/i, "Lebensmittel", 0.93],
  [/kita|kindergarten/i, "Kind & Kita", 0.9],
  [/versicherung/i, "Versicherungen", 0.9],
  [/spotify|anthropic|netflix|telekom/i, "Abos & Software", 0.85],
  [/thomann|bandcamp/i, "Musik & Equipment", 0.85],
  [/aral|shell|bahn|tankstelle/i, "Mobilität", 0.88],
  [/apotheke/i, "Gesundheit", 0.85],
  [/zoo|kino/i, "Freizeit", 0.8],
  [/zalando/i, "Kleidung", 0.6],
  [/dm-drogerie|rossmann/i, "Haushalt", 0.65],
  [/tagesgeld|sparrate/i, "Umbuchung", 0.9],
];

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
