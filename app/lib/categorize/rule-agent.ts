import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";
import type { Rule } from "~/lib/db/schema";
import { safeError } from "~/lib/security.server";
import { redactIbans } from "./llm";
import { firstMatchingRule, ruleMatches } from "./rules";

/** What the agent may suggest: plain "contains"/"equals", never a regex from a model. */
export type RuleProposal = {
  field: "counterparty" | "purpose";
  matchType: "contains" | "equals";
  pattern: string;
  categoryId: string;
  categoryName: string;
  /** "lokal" when understood without a model; then it cost nothing. */
  source: "lokal" | "ki";
};

type Category = { id: string; name: string };

function fold(s: string): string {
  return s
    .toLocaleLowerCase("de")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** "Hobby" finds "Hobbys", "Restaurant" finds "Restaurant & Lieferdienst", "Abo" finds "Abos & Verträge". */
export function findCategory(text: string, categories: Category[]): Category | null {
  const words = fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
  let best: { category: Category; score: number } | null = null;
  for (const category of categories) {
    const name = fold(category.name);
    const tokens = name.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
    let score = 0;
    if (fold(text).includes(name)) score = 100;
    for (const token of tokens) {
      for (const word of words) {
        if (word === token) score = Math.max(score, 50);
        else if (token.startsWith(word) || word.startsWith(token)) score = Math.max(score, 30);
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { category, score };
  }
  return best?.category ?? null;
}

// "Lieferando ist Restaurant", "alles von Thomann → Hobby", "Zahlungen an Netflix sind Abos".
const SPLIT =
  /^(.+?)\s*(?:\bist\b|\bsind\b|\bgehört\b|\bgehören\b|\bkommt\b|\bkommen\b|\bals\b|\bzu\b|=|→|->|:)\s*(.+)$/i;
const LEAD =
  /^(?:immer\s+)?(?:alles|alle|jede|jeden)?\s*(?:buchungen|zahlungen|abbuchungen|überweisungen|einkäufe|käufe|lastschriften)?\s*(?:von|bei|an|mit|vom|beim|für)?\s+/i;
const PURPOSE = /\b(?:im|in|mit)\s+(?:dem\s+)?(?:verwendungszweck|zweck|betreff|buchungstext)\b/i;
const FILLER = /\b(?:immer|bitte|grundsätzlich|ab jetzt|künftig|die kategorie|kategorie|in die|unter|nach)\b/gi;

/** "Netflix und Spotify", "Aldi, Lidl oder Rewe" are several payees; "H&M" is one. */
const LIST = /\s*,\s*|\s+(?:und|oder|sowie|&|\+)\s+/i;

/** Cheap first: a plain sentence is understood without any model. Empty when unsure. */
export function parseRuleWish(text: string, categories: Category[]): RuleProposal[] {
  const clean = text.trim().replace(/[.!?]+$/, "");
  const m = SPLIT.exec(clean);
  if (!m?.[1] || !m[2]) return [];
  const field = PURPOSE.test(m[1]) ? "purpose" : "counterparty";
  const category = findCategory(m[2].replace(FILLER, " "), categories);
  if (!category) return [];
  const patterns = m[1]
    .replace(PURPOSE, " ")
    .replace(LEAD, "")
    .split(LIST)
    .map((p) =>
      p
        .replace(LEAD, "")
        .replace(/["„“”']/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  if (patterns.some((p) => p.length < 3 || p.length > 60) || patterns.length > 5) return [];
  return patterns.map((pattern) => ({
    field,
    matchType: "contains",
    pattern,
    categoryId: category.id,
    categoryName: category.name,
    source: "lokal",
  }));
}

const answerSchema = z.object({
  understood: z.boolean(),
  field: z.enum(["counterparty", "purpose"]),
  matchType: z.enum(["contains", "equals"]),
  patterns: z.array(z.string().max(80)).max(5),
  category: z.string().max(80),
});

const SYSTEM = `Du machst aus einem Wunsch eines Nutzers eine Regel für sein Haushaltsbuch.
Eine Regel: Wenn der Empfänger (field "counterparty") oder der Verwendungszweck (field "purpose") den Text
einen der Texte in "patterns" enthält (matchType "contains") oder genau ist ("equals"), bekommt die Buchung die
Kategorie. Mehrere Händler im Wunsch ergeben mehrere patterns.
- category: exakt ein Name aus der Kategorienliste.
- patterns: je Händler kurz und eindeutig, wie er in Buchungen vorkommt (z. B. "lieferando", nicht "Alles von Lieferando").
  Wenn ein passender Empfänger in der Liste bekannter Empfänger steht, nimm dessen markanten Teil.
- Fast immer field "counterparty" und matchType "contains".
- understood=false, wenn der Wunsch keine Regel ist oder unklar bleibt.`;

/**
 * Local parsing first; the model only for sentences the parser does not get. Only the sentence,
 * category names and a few matching payee names leave the app.
 */
export async function proposeRule(
  text: string,
  categories: Category[],
  knownCounterparties: string[],
  model: LanguageModel | null,
  onError: (error: unknown) => void = (error) => console.error(`Regel-Agent fehlgeschlagen: ${safeError(error)}`),
): Promise<RuleProposal[]> {
  const local = parseRuleWish(text, categories);
  if (local.length > 0) return local;
  if (!model) return [];
  const words = fold(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  const hints = [...new Set(knownCounterparties)]
    .filter((c) => words.some((w) => fold(c).includes(w)))
    .slice(0, 15)
    .map(redactIbans);
  try {
    const { output } = await generateText({
      model,
      system: SYSTEM,
      prompt: JSON.stringify({
        wunsch: text.slice(0, 300),
        kategorien: categories.map((c) => c.name),
        bekannteEmpfaenger: hints,
      }),
      output: Output.object({ schema: answerSchema }),
      maxRetries: 1,
      maxOutputTokens: 200,
    });
    if (!output.understood) return [];
    const category = categories.find((c) => fold(c.name) === fold(output.category));
    const patterns = output.patterns.map((p) => p.trim()).filter((p) => p.length >= 2);
    if (!category || patterns.length === 0) return [];
    return patterns.map((pattern) => ({
      field: output.field,
      matchType: output.matchType,
      pattern,
      categoryId: category.id,
      categoryName: category.name,
      source: "ki" as const,
    }));
  } catch (error) {
    onError(error);
    return [];
  }
}

export type RulePreview = {
  matches: number;
  /** Bookings whose category would actually change (manual ones are never touched). */
  changes: number;
  examples: { counterparty: string; amountCents: number; bookingDate: string }[];
  /** Set above older rules that say otherwise for the same bookings: the latest wish wins. */
  priority: number;
};

type PreviewBooking = {
  counterparty: string;
  purpose: string;
  amountCents: number;
  bookingDate: string;
  categoryId: string | null;
  categorySource: string | null;
};
type ExistingRule = Pick<Rule, "field" | "matchType" | "pattern" | "categoryId" | "priority" | "createdAt">;

/**
 * What saving would do, computed with all existing rules: the new rule sits just above any older rule that
 * would put the same bookings elsewhere, so "Spotify ist Abo" beats an old "Spotify AB → Freizeit".
 */
export function previewRule(
  proposal: Pick<RuleProposal, "field" | "matchType" | "pattern" | "categoryId">,
  bookings: PreviewBooking[],
  existing: ExistingRule[] = [],
): RulePreview {
  const hits = bookings.filter((b) => ruleMatches(proposal, b));
  const conflicting = existing.filter(
    (r) => r.categoryId !== proposal.categoryId && hits.some((b) => ruleMatches(r, b)),
  );
  const priority = conflicting.length > 0 ? Math.min(1000, Math.max(...conflicting.map((r) => r.priority)) + 1) : 0;
  const candidate = { ...proposal, priority, createdAt: new Date(8.64e15) };
  const changes = hits.filter(
    (b) =>
      b.categorySource !== "manual" &&
      b.categoryId !== proposal.categoryId &&
      firstMatchingRule([...existing, candidate], b) === candidate,
  ).length;
  const examples = [...hits]
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate))
    .slice(0, 3)
    .map(({ counterparty, amountCents, bookingDate }) => ({ counterparty, amountCents, bookingDate }));
  return { matches: hits.length, changes, examples, priority };
}
