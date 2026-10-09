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
  if (!process.env.ANTHROPIC_API_KEY) return null;
  // Keys that span several workspaces are rejected unless each request names the workspace.
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const provider = createAnthropic({
    headers: workspace ? { "anthropic-workspace-id": workspace } : undefined,
    fetch: options.fetch,
  });
  return provider(process.env.AI_MODEL || DEFAULT_MODEL);
}
