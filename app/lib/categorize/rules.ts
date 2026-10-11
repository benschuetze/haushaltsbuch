import { z } from "zod";
import type { Rule } from "~/lib/db/schema";

type Matchable = Pick<Rule, "field" | "matchType" | "pattern">;

export const ruleInputSchema = z
  .object({
    field: z.enum(["counterparty", "purpose"]),
    matchType: z.enum(["contains", "equals", "regex"]),
    pattern: z.string().trim().min(1, "Muster fehlt").max(200),
    categoryId: z.uuid("Kategorie fehlt"),
    priority: z.coerce.number().int().min(-1000).max(1000).default(0),
  })
  .refine((r) => r.matchType !== "regex" || isValidRegex(r.pattern), {
    message: "Ungültiger regulärer Ausdruck",
    path: ["pattern"],
  })
  .refine((r) => r.matchType !== "regex" || !slowRegex(r.pattern), {
    message: "Dieser Ausdruck kann sehr langsam werden (verschachtelte Wiederholung). Bitte einfacher formulieren.",
    path: ["pattern"],
  });

/** "(a+)+" and similar can take exponential time on unlucky input (ReDoS); such rules are refused. */
export function hasNestedQuantifier(pattern: string): boolean {
  return /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(pattern);
}

/**
 * Patterns that can backtrack exponentially: a repeated group that itself repeats, a repeated group with
 * alternatives ("(a|aa)+" matches the same text in many ways), and backreferences. Rules can come from the
 * rule agent too, which reads bank texts, so this is checked on save and again before every match.
 */
export function slowRegex(pattern: string): boolean {
  const repeatedGroupWithAlternatives = /\((?:[^()\\]|\\.)*\|(?:[^()\\]|\\.)*\)\s*[+*{]/;
  return hasNestedQuantifier(pattern) || repeatedGroupWithAlternatives.test(pattern) || /\\[1-9]/.test(pattern);
}

function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    return false;
  }
}

export function ruleMatches(rule: Matchable, tx: { counterparty: string; purpose: string }): boolean {
  const value = (rule.field === "counterparty" ? tx.counterparty : tx.purpose).toLocaleLowerCase("de");
  const pattern = rule.pattern.toLocaleLowerCase("de");
  switch (rule.matchType) {
    case "equals":
      return value.trim() === pattern.trim();
    case "contains":
      return value.includes(pattern);
    case "regex":
      // Stored regexes are validated on save; a broken one from an older version must not take the import down.
      // Slow patterns saved by an older version are skipped; bounded input guards against the rest.
      return (
        isValidRegex(rule.pattern) &&
        !slowRegex(rule.pattern) &&
        new RegExp(rule.pattern, "i").test(value.slice(0, 300))
      );
  }
}

/** Highest priority wins; on a tie the older rule wins so adding a rule never silently reshuffles existing ones. */
export function sortRules<T extends Pick<Rule, "priority" | "createdAt">>(rules: T[]): T[] {
  return [...rules].sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());
}

export function firstMatchingRule<T extends Matchable & Pick<Rule, "priority" | "createdAt">>(
  rules: T[],
  tx: { counterparty: string; purpose: string },
): T | undefined {
  return sortRules(rules).find((r) => ruleMatches(r, tx));
}
