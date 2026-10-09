import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { failingModel, scriptedModel } from "../../../tests/helpers/models";
import { createMockModel } from "./mock-model";
import { aiSmokeTest } from "./smoke";

describe("aiSmokeTest", () => {
  it("meldet nichts, wenn alle drei Wege funktionieren", async () => {
    expect(await aiSmokeTest(createMockModel(), toolModel())).toEqual([]);
  });

  it("meldet, wenn das Modell keine Werkzeuge aufruft", async () => {
    const problems = await aiSmokeTest(createMockModel(), scriptedModel("Die Zahl ist 4711").model);
    expect(problems).toEqual(["Assistent: Werkzeug wurde nicht aufgerufen"]);
  });

  it("meldet einen API-Fehler mit seiner Ursache, statt still in „prüfen“ zu landen", async () => {
    const problems = await aiSmokeTest(failingModel());
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/^Kategorisierung: Netzwerk weg/);
    expect(problems[1]).toMatch(/^Spaltenzuordnung: Netzwerk weg/);
    expect(problems[2]).toMatch(/^Assistent: Netzwerk weg/);
  });

  it("meldet unbrauchbare Antworten", async () => {
    const { model } = scriptedModel(JSON.stringify({ results: [] }));
    const problems = await aiSmokeTest(model);
    expect(problems[0]).toBe("Kategorisierung: Antwort ohne gültige Kategorie");
  });
});

/** Calls the tool first, then answers with what it returned, like a working model. */
function toolModel() {
  const usage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 0, text: 0, reasoning: undefined },
  };
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) =>
      JSON.stringify(prompt).includes("4711")
        ? {
            content: [{ type: "text", text: "Die Prüfzahl ist 4711." }],
            finishReason: { unified: "stop", raw: undefined },
            usage,
            warnings: [],
          }
        : {
            content: [{ type: "tool-call", toolCallId: "t1", toolName: "pruefzahl", input: "{}" }],
            finishReason: { unified: "tool-calls", raw: undefined },
            usage,
            warnings: [],
          },
  });
}
