import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { createMockModel } from "./mock-model";

export const DEFAULT_MODEL = "claude-haiku-5-5";

/**
 * null means no model configured: everything rules don't catch goes straight to review.
 * `fetch` is only for tests, so they can see the request without sending it.
 */
export function getModel(options: { fetch?: typeof fetch } = {}): LanguageModel | null {
  if (process.env.AI_MOCK === "1") return createMockModel();
  return getLiveModel(options);
}

/** The real model regardless of AI_MOCK; null without a key. */
export function getLiveModel(options: { fetch?: typeof fetch } = {}): LanguageModel | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // Keys that span several workspaces are rejected unless each request names the workspace.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const provider = createAnthropic({
    headers: workspace ? { "anthropic-workspace-id": workspace } : undefined,
    fetch: options.fetch,
  });
  return provider(process.env.AI_MODEL || DEFAULT_MODEL);
}

/**
 * The assistant needs tool calling; the keyword mock for categorisation cannot do that, so it has its own.
 * ASSISTANT_LIVE=1 lets the public demo talk to the real model while its categorisation stays on the mock,
 * so a deploy that re-imports the demo data costs nothing.
 */
export async function getAssistantModel(): Promise<LanguageModel | null> {
  if (process.env.ASSISTANT_LIVE === "1") return getLiveModel();
  if (process.env.AI_MOCK === "1") {
    const { createMockAssistantModel } = await import("~/lib/assistant/mock-model");
    return createMockAssistantModel();
  }
  return getModel();
}
