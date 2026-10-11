import { generateText, isStepCount, type LanguageModel, type ModelMessage } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/lib/db/client";
import { meta } from "~/lib/db/schema";
import { safeError } from "~/lib/security.server";
import { createAssistantTools } from "./tools.server";

export const MAX_HISTORY = 10;
export const MAX_MESSAGE = 1000;
/**
 * Per calendar day. Each question is a few small model calls; this caps a runaway loop or a stuck key.
 * The public demo sets a lower ASSISTANT_DAILY_LIMIT: anyone can ask there, and every answer costs.
 */
export function dailyLimit(): number {
  const n = Number(process.env.ASSISTANT_DAILY_LIMIT || Number.NaN);
  return Number.isInteger(n) && n > 0 ? n : 60;
}

export const chatSchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(MAX_MESSAGE) }))
  .min(1)
  .max(MAX_HISTORY)
  .refine((m) => m.at(-1)?.role === "user", "Die letzte Nachricht muss eine Frage sein.");
export type ChatMessage = z.infer<typeof chatSchema>[number];

export const SYSTEM = `Du bist der Assistent im Haushaltsbuch einer Privatperson in Deutschland.
- Antworte auf Deutsch, kurz und direkt wie ein guter Freund mit Ahnung von Geld: erst die Antwort mit Zahl, dann höchstens ein Satz Begründung. Beträge mit Euro-Zeichen. Datumsangaben als „1. November“.
- „Wie viel kann ich (heute) ausgeben / was ist drin?“: heute_verfuegbar; den Tagesbetrag nennst du „Tagesbudget“. „Kann ich mir X leisten?“: leisten mit dem Betrag. „Wann kommt das Gehalt / was geht noch ab?“: naechste_zahlungen.
- „Wann kann ich mir X leisten?“ oder große Anschaffungen: wann_leisten. Wenn leisten „nein“ ergibt, ruf auch wann_leisten auf und nenn den Monat. Fragen zu Sparzielen: sparziele. „Wie lief meine Woche?“: woche.
- Wenn gehaltNochNichtGebucht gesetzt ist, sag kurz dazu, dass das Gehalt noch nicht in den Buchungen ist und die Zahl deshalb vorsichtig ist.
- Bei leisten: locker = klares Ja; geht = Ja, mit dem Betrag pro Tag danach; knapp = ehrlich sagen, dass es eng wird; nein = Nein, mit dem fehlenden Betrag. Nie moralisieren.
- Antworte knapp: höchstens 120 Wörter.
- Nutze die Werkzeuge, um echte Zahlen nachzusehen. Erfinde nie Buchungen, Beträge oder Abos.
- Bei Fragen nach Abos, versteckten Kosten oder Verträgen: abos_und_fixkosten aufrufen und auch Zahlungen nennen, die nicht als Abo kategorisiert sind.
- Wenn ein Monat nicht genannt ist, nimm den neuesten aus „monate“.
- Du kannst nichts ändern, buchen oder löschen. Wenn jemand das möchte, sag, wo es in der App geht (Buchungen, Budgets, Regeln, Banken).
- Keine Anlage-, Steuer- oder Rechtsberatung; allgemeine Spartipps sind in Ordnung.`;

async function withinDailyLimit(db: Db, now: Date): Promise<boolean> {
  const key = `assistant_calls_${now.toISOString().slice(0, 10)}`;
  const [row] = await db.select().from(meta).where(eq(meta.key, key));
  const used = Number(row?.value ?? 0);
  if (used >= dailyLimit()) return false;
  await db
    .insert(meta)
    .values({ key, value: String(used + 1) })
    .onConflictDoUpdate({ target: meta.key, set: { value: String(used + 1) } });
  return true;
}

export type AssistantReply = { answer: string; tools: string[] };

export type Tone = "freundlich" | "frech";

/** The facts stay the same; only the voice changes. "Frech" teases about spending, never about the person. */
const TONE: Record<Tone, string> = {
  freundlich: "Ton: freundlich und ermutigend.",
  frech:
    "Ton: frech. Antworte mit trockenem Humor und einem kleinen Seitenhieb auf das Ausgabeverhalten (z. B. „Schon wieder Lieferando?“), wie ein guter Kumpel. Nie beleidigend, nie über die Person, die Zahlen bleiben exakt.",
};

export function toneFrom(value: unknown): Tone {
  return value === "frech" ? "frech" : "freundlich";
}

/** Thinking blocks are signed for the request that produced them; sent again, the API rejects the whole call. */
function withoutThinking(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === "assistant" && Array.isArray(m.content)
      ? { ...m, content: m.content.filter((part) => part.type !== "reasoning") }
      : m,
  );
}

export async function askAssistant(
  db: Db,
  model: LanguageModel,
  history: ChatMessage[],
  now = new Date(),
  tone: Tone = "freundlich",
): Promise<AssistantReply> {
  if (!(await withinDailyLimit(db, now))) {
    return { answer: `Für heute ist das Limit von ${dailyLimit()} Fragen erreicht. Morgen geht es weiter.`, tools: [] };
  }
  try {
    const system = `${SYSTEM}\n- ${TONE[tone]}`;
    const messages = history.map((m) => ({ role: m.role, content: m.content }));
    const result = await generateText({
      model,
      system,
      messages,
      tools: createAssistantTools(db, now),
      stopWhen: isStepCount(6),
      maxOutputTokens: 1500,
      maxRetries: 1,
    });
    const tools = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    let answer = result.text.trim();
    // The budget can run out mid-way through yet another tool call: the text is then empty or cut off.
    // One more call without tools, on the tool results that did complete, turns them into an answer.
    if (!answer || result.finishReason === "length") {
      const done = result.steps.filter((s) => s.finishReason === "tool-calls").at(-1);
      const summary = await generateText({
        model,
        system,
        messages: [
          ...messages,
          ...withoutThinking(done?.response.messages ?? []),
          { role: "user", content: "Antworte jetzt kurz mit dem, was du nachgesehen hast, ohne weitere Werkzeuge." },
        ],
        maxOutputTokens: 600,
        maxRetries: 1,
      });
      answer = summary.text.trim() || answer;
    }
    return { answer: answer || "Dazu habe ich keine Antwort gefunden.", tools };
  } catch (error) {
    console.error(`Assistent fehlgeschlagen: ${safeError(error)}`);
    return { answer: "Gerade kann ich nicht antworten. Bitte später noch einmal versuchen.", tools: [] };
  }
}
