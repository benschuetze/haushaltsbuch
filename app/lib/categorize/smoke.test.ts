import { describe, expect, it } from "vitest";
import { failingModel, scriptedModel } from "../../../tests/helpers/models";
import { createMockModel } from "./mock-model";
import { aiSmokeTest } from "./smoke";

describe("aiSmokeTest", () => {
  it("meldet nichts, wenn beide Wege funktionieren", async () => {
    expect(await aiSmokeTest(createMockModel())).toEqual([]);
  });

  it("meldet einen API-Fehler mit seiner Ursache, statt still in „prüfen“ zu landen", async () => {
    const problems = await aiSmokeTest(failingModel());
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^Kategorisierung: Netzwerk weg/);
    expect(problems[1]).toMatch(/^Spaltenzuordnung: Netzwerk weg/);
  });

  it("meldet unbrauchbare Antworten", async () => {
    const { model } = scriptedModel(JSON.stringify({ results: [] }));
    const problems = await aiSmokeTest(model);
    expect(problems[0]).toBe("Kategorisierung: Antwort ohne gültige Kategorie");
  });
});
