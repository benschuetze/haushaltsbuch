import { generateText } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getAssistantModel, getModel } from "./model";

afterEach(() => vi.unstubAllEnvs());

/** Captures what would go to the Anthropic API, without sending anything or spending credits. */
async function sentHeaders(): Promise<Headers> {
  let captured = new Headers();
  const fakeFetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    captured = new Headers(init?.headers);
    return new Response(JSON.stringify({ type: "error", error: { type: "stop", message: "nur Test" } }), {
      status: 400,
    });
  });
  const model = getModel({ fetch: fakeFetch as unknown as typeof fetch });
  if (!model) throw new Error("kein Modell");
  await generateText({ model, prompt: "x", maxRetries: 0 }).catch(() => undefined);
  expect(fakeFetch).toHaveBeenCalledTimes(1);
  return captured;
}

describe("getModel", () => {
  it("schickt die Workspace-ID mit, wenn eine gesetzt ist (Pflicht bei Keys ohne festen Workspace)", async () => {
    vi.stubEnv("AI_MOCK", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-ohne-wert");
    vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "wrkspc_test");
    expect((await sentHeaders()).get("anthropic-workspace-id")).toBe("wrkspc_test");
  });

  it("ohne Workspace-ID kein solcher Header", async () => {
    vi.stubEnv("AI_MOCK", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-ohne-wert");
    vi.stubEnv("ANTHROPIC_WORKSPACE_ID", "");
    expect((await sentHeaders()).has("anthropic-workspace-id")).toBe(false);
  });

  it("ohne Key kein Modell, mit AI_MOCK das Testmodell", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_MOCK", "");
    expect(getModel()).toBeNull();
    vi.stubEnv("AI_MOCK", "1");
    expect(getModel()).not.toBeNull();
  });
});

describe("getAssistantModel", () => {
  const modelId = (m: unknown) => (m as { modelId?: string } | null)?.modelId;

  it("öffentliche Demo: Kategorisierung bleibt beim Testmodell, der Assistent spricht mit dem echten Modell", async () => {
    vi.stubEnv("AI_MOCK", "1");
    vi.stubEnv("ASSISTANT_LIVE", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-ohne-wert");
    vi.stubEnv("AI_MODEL", "");
    expect(modelId(getModel())).not.toBe("claude-haiku-5-5");
    expect(modelId(await getAssistantModel())).toBe("claude-haiku-5-5");
  });

  it("ohne ASSISTANT_LIVE antwortet in der Demo weiter das Testmodell", async () => {
    vi.stubEnv("AI_MOCK", "1");
    vi.stubEnv("ASSISTANT_LIVE", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key-ohne-wert");
    expect(modelId(await getAssistantModel())).not.toBe("claude-haiku-5-5");
  });

  it("ASSISTANT_LIVE ohne Key: kein Modell statt still das Testmodell", async () => {
    vi.stubEnv("AI_MOCK", "1");
    vi.stubEnv("ASSISTANT_LIVE", "1");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await getAssistantModel()).toBeNull();
  });
});
