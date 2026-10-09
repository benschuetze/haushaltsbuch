import { MockLanguageModelV4 } from "ai/test";

type Call = Parameters<MockLanguageModelV4["doGenerate"]>[0];

/** A model that answers with fixed text and records what it was sent. */
export function scriptedModel(answer: string | ((call: Call) => string)) {
  const calls: Call[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (call) => {
      calls.push(call);
      return {
        content: [{ type: "text", text: typeof answer === "string" ? answer : answer(call) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}

export function failingModel() {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw new Error("Netzwerk weg");
    },
  });
}

export function promptText(call: Call): string {
  return JSON.stringify(call.prompt);
}
