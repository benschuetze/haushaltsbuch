import { generateText, isStepCount, type LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "~/lib/db/client";
import { meta } from "~/lib/db/schema";
import { safeError } from "~/lib/security.server";
import { createAssistantTools } from "./tools.server";

export const MAX_HISTORY = 10;
export const MAX_MESSAGE = 1000;
/** Per calendar day. Each question is a few small model calls; this caps a runaway loop or a stuck key. */
export const DAILY_LIMIT = 60;

export const chatSchema = z
  .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(MAX_MESSAGE) }))
  .min(1)
  .max(MAX_HISTORY)
  .refine((m) => m.at(-1)?.role === "user", "Die letzte Nachricht muss eine Frage sein.");
export type ChatMessage = z.infer<typeof chatSchema>[number];

export const SYSTEM = `Du bist der Assistent im Haushaltsbuch einer Privatperson in Deutschland.
- Antworte auf Deutsch, kurz und direkt wie ein guter Freund mit Ahnung von Geld: erst die Antwort mit Zahl, dann höchstens ein Satz Begründung. Beträge mit Euro-Zeichen. Datumsangaben als „1. November“.
- „Wie viel kann ich (heute) ausgeben / was ist drin?“: heute_verfuegbar. „Kann ich mir X leisten?“: leisten mit dem Betrag. „Wann kommt das Gehalt / was geht noch ab?“: naechste_zahlungen.
- „Wann kann ich mir X leisten?“ oder große Anschaffungen: wann_leisten. Wenn leisten „nein“ ergibt, ruf auch wann_leisten auf und nenn den Monat. Fragen zu Sparzielen: sparziele. „Wie lief meine Woche?“: woche.
- Wenn gehaltNochNichtGebucht gesetzt ist, sag kurz dazu, dass das Gehalt noch nicht in den Buchungen ist und die Zahl deshalb vorsichtig ist.
- Bei leisten: locker = klares Ja; geht = Ja, mit dem Betrag pro Tag danach; knapp = ehrlich sagen, dass es eng wird; nein = Nein, mit dem fehlenden Betrag. Nie moralisieren.
- Nutze die Werkzeuge, um echte Zahlen nachzusehen. Erfinde nie Buchungen, Beträge oder Abos.
- Bei Fragen nach Abos, versteckten Kosten oder Verträgen: abos_und_fixkosten aufrufen und auch Zahlungen nennen, die nicht als Abo kategorisiert sind.
- Wenn ein Monat nicht genannt ist, nimm den neuesten aus „monate“.
- Du kannst nichts ändern, buchen oder löschen. Wenn jemand das möchte, sag, wo es in der App geht (Buchungen, Budgets, Regeln, Banken).
- Keine Anlage-, Steuer- oder Rechtsberatung; allgemeine Spartipps sind in Ordnung.`;

async function withinDailyLimit(db: Db, now: Date): Promise<boolean> {
  const key = `assistant_calls_${now.toISOString().slice(0, 10)}`;
  const [row] = await db.select().from(meta).where(eq(meta.key, key));
  const used = Number(row?.value ?? 0);
  if (used >= DAILY_LIMIT) return false;
  await db
    .insert(meta)
    .values({ key, value: String(used + 1) })
    .onConflictDoUpdate({ target: meta.key, set: { value: String(used + 1) } });
  return true;
}

export type AssistantReply = { answer: string; tools: string[] };

export async function askAssistant(
  db: Db,
  model: LanguageModel,
  history: ChatMessage[],
  now = new Date(),
): Promise<AssistantReply> {
  if (!(await withinDailyLimit(db, now))) {
    return { answer: `Für heute ist das Limit von ${DAILY_LIMIT} Fragen erreicht. Morgen geht es weiter.`, tools: [] };
  }
  try {
    const result = await generateText({
      model,
      system: SYSTEM,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      tools: createAssistantTools(db, now),
      stopWhen: isStepCount(6),
      maxOutputTokens: 800,
      maxRetries: 1,
    });
    const tools = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));
    return { answer: result.text.trim() || "Dazu habe ich keine Antwort gefunden.", tools };
  } catch (error) {
    console.error(`Assistent fehlgeschlagen: ${safeError(error)}`);
    return { answer: "Gerade kann ich nicht antworten. Bitte später noch einmal versuchen.", tools: [] };
  }
}
