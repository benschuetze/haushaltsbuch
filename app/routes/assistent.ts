import { data } from "react-router";
import { askAssistant, chatSchema, toneFrom } from "~/lib/assistant/agent.server";
import { getAssistantModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import type { Route } from "./+types/assistent";

/** Resource route for the chat. Read-only tools, so it is also open in the demo (where the mock model answers). */
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  let parsed: ReturnType<typeof chatSchema.safeParse>;
  try {
    parsed = chatSchema.safeParse(JSON.parse(String(form.get("messages") ?? "[]")));
  } catch {
    return data({ answer: "Die Nachricht ließ sich nicht lesen.", tools: [] }, { status: 400 });
  }
  if (!parsed.success) {
    return data({ answer: parsed.error.issues[0]?.message ?? "Ungültige Nachricht.", tools: [] }, { status: 400 });
  }
  const model = await getAssistantModel();
  if (!model)
    return data({ answer: "Der Assistent ist nicht eingerichtet (kein KI-Schlüssel).", tools: [] }, { status: 503 });
  return data(await askAssistant(getDb(), model, parsed.data, new Date(), toneFrom(form.get("ton"))));
}
