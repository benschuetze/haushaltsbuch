import { MockLanguageModelV4 } from "ai/test";

/**
 * Deterministic stand-in for the demo and for tests: picks tools by keyword and phrases an answer from the real
 * tool results. It never invents numbers; everything it says comes from the tools, like the real model should.
 */
type Part = { type: string; text?: string; toolName?: string; output?: { type: string; value: unknown } };
type Message = { role: string; content: string | Part[] };

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

function call(toolName: string, input: object) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `call-${toolName}-${Math.random().toString(36).slice(2, 8)}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function say(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

type Row = Record<string, unknown>;

function phrase(toolName: string, value: Row): string {
  if (toolName === "abos_und_fixkosten") {
    const all = (value.zahlungen as Row[]) ?? [];
    const abos = all.filter((z) => z.art === "Abo");
    if (all.length === 0)
      return "Ich habe keine wiederkehrenden Zahlungen gefunden. Dafür braucht es Auszüge aus mehreren Monaten.";
    const hidden = abos.filter((z) => z.kategorie !== "Abos & Software");
    const list = abos.map((z) => `${z.name} (${z.proJahr} im Jahr)`).join(", ");
    return `Ich habe ${abos.length} laufende Abos gefunden: ${list}.${
      hidden.length > 0
        ? ` Nicht als Abo einsortiert und leicht zu übersehen: ${hidden.map((z) => z.name).join(", ")}.`
        : ""
    }`;
  }
  if (toolName === "budgets") {
    const items = (value.budgets as Row[]) ?? [];
    const tight = items.filter((b) => Number(b.prozent) >= 80);
    return tight.length === 0
      ? `Alle ${items.length} Budgets liegen im ${value.monat} unter 80 Prozent.`
      : `Knapp oder drüber im ${value.monat}: ${tight.map((b) => `${b.kategorie} ${b.ausgegeben} von ${b.budget} (${b.prozent} %)`).join(", ")}.`;
  }
  if (toolName === "hinweise") {
    const items = (value.hinweise as Row[]) ?? [];
    return items.length === 0
      ? "Gerade gibt es keine offenen Hinweise."
      : `Offene Hinweise: ${items.map((h) => h.titel).join("; ")}.`;
  }
  if (toolName === "monatsuebersicht") {
    const cats = ((value.kategorien as Row[]) ?? []).filter((c) => String(c.summe).startsWith("−")).slice(0, 3);
    return `Im ${value.monat}: Einnahmen ${value.einnahmen}, Ausgaben ${value.ausgaben}. Größte Posten: ${cats.map((c) => `${c.kategorie} ${c.summe}`).join(", ")}.`;
  }
  if (toolName === "buchungen_suchen") {
    const rows = (value.buchungen as Row[]) ?? [];
    if (rows.length === 0) return "Dazu habe ich keine Buchungen gefunden.";
    return `${rows.length} Treffer, zum Beispiel: ${rows
      .slice(0, 3)
      .map((r) => `${r.datum} ${r.empfaenger} ${r.betrag}`)
      .join("; ")}.`;
  }
  return "Erledigt.";
}

export function createMockAssistantModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const messages = prompt as unknown as Message[];
      const last = messages.at(-1);
      if (last?.role === "tool" && Array.isArray(last.content)) {
        const result = last.content.find((p) => p.type === "tool-result");
        const value = (result?.output?.value ?? {}) as Row;
        if (result?.toolName === "monate") {
          const months = (value.monate as string[]) ?? [];
          return months[0] ? call("monatsuebersicht", { monat: months[0] }) : say("Es gibt noch keine Buchungen.");
        }
        return say(phrase(result?.toolName ?? "", value));
      }
      const question = [...messages].reverse().find((m) => m.role === "user")?.content;
      const text = (
        typeof question === "string" ? question : (question ?? []).map((p) => p.text ?? "").join(" ")
      ).toLowerCase();
      if (/abo|vertrag|versteckt|wiederkehr|monatlich zahl/.test(text)) return call("abos_und_fixkosten", {});
      if (/budget/.test(text)) return call("budgets", {});
      if (/hinweis|sparen|spar/.test(text)) return call("hinweise", {});
      if (/ausgab|einnahm|übersicht|monat/.test(text)) return call("monate", {});
      const word = /(?:für|bei|von|nach)\s+([a-zäöüß0-9-]{3,})/i.exec(text)?.[1];
      return call("buchungen_suchen", word ? { suchbegriff: word, limit: 5 } : { limit: 5 });
    },
  });
}
