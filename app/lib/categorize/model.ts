import { anthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { createMockModel } from "./mock-model";

export const DEFAULT_MODEL = "claude-haiku-5-5";

/** null means no model configured: everything rules don't catch goes straight to review. */
export function getModel(): LanguageModel | null {
  if (process.env.AI_MOCK === "1") return createMockModel();
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return anthropic(process.env.AI_MODEL || DEFAULT_MODEL);
}
