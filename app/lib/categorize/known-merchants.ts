/**
 * Built-in rules for merchants everyone in Germany knows. They run after the user's own rules and before the
 * model: free, instant, and the same answer every time. Matched on the counterparty only; a purpose like
 * "PayPal ... Lieferando" on the current account is a transfer, not a meal.
 * Order matters where names overlap: "Uber Eats" is food delivery before "Uber" is a ride.
 */
export const KNOWN_MERCHANTS: { category: string; examples: string; pattern: RegExp }[] = [
  {
    category: "Restaurant & Lieferdienst",
    examples: "Lieferando, Wolt, Uber Eats, McDonald's, Starbucks",
    pattern:
      /\b(lieferando|wolt|uber\s*eats|deliveroo|mcdonald'?s|burger king|starbucks|subway|vapiano|domino'?s|kfc)\b/i,
  },
  {
    category: "Lebensmittel",
    examples: "REWE, EDEKA, ALDI, Lidl, Netto, Penny, Kaufland",
    pattern: /\b(rewe|edeka|aldi|lidl|netto|penny|kaufland|tegut|globus|norma|denns|alnatura|bäckerei|baeckerei)\b/i,
  },
  {
    category: "Abos & Verträge",
    examples: "Netflix, Disney+, Spotify, Amazon Prime, Apple, Telekom, Vodafone, FitX",
    pattern:
      /\b(netflix|disney\s*(plus|\+)?|spotify|amazon prime|prime video|audible|dazn|sky deutschland|rtl\+|joyn|deezer|tidal|youtube premium|apple\.com|itunes|icloud|microsoft|adobe|dropbox|openai|chatgpt|anthropic|playstation|xbox|telekom|vodafone|o2|telef[oó]nica|1\s*&\s*1|1und1|congstar|fitx|mcfit|urban sports)\b/i,
  },
  {
    category: "Mobilität",
    examples: "Aral, Shell, ESSO, Deutsche Bahn, BVG, FlixBus",
    pattern:
      /\b(aral|shell|esso|jet tankstelle|totalenergies|db vertrieb|deutsche bahn|bvg|mvg|hvv|flixbus|uber|free now|tier mobility|lime)\b/i,
  },
  {
    category: "Haushalt",
    examples: "dm, Rossmann, IKEA, OBI, Bauhaus, Hornbach",
    pattern: /\b(dm-drogerie|dm drogerie|rossmann|müller drogerie|ikea|obi|bauhaus|hornbach|toom)\b/i,
  },
  {
    category: "Kleidung",
    examples: "Zalando, H&M, Zara, C&A, Primark, About You",
    pattern: /\b(zalando|h\s*&\s*m|zara|c\s*&\s*a|primark|about you|deichmann)\b/i,
  },
  {
    category: "Gesundheit",
    examples: "Apotheken, DocMorris, Shop Apotheke",
    pattern: /\b(apotheke|docmorris|shop apotheke)\b/i,
  },
  {
    category: "Freizeit",
    examples: "CinemaxX, Zoo, Eventim",
    pattern: /\b(cinemaxx|kino|zoo|eventim)\b/i,
  },
  { category: "Haustier", examples: "Fressnapf, zooplus", pattern: /\b(fressnapf|zooplus)\b/i },
  {
    category: "Wohnen",
    examples: "Stadtwerke, Hausverwaltung, Vattenfall, E.ON",
    pattern: /\b(stadtwerke|hausverwaltung|vattenfall|e\.on|enbw)\b/i,
  },
  {
    category: "Versicherungen",
    examples: "Allianz, HUK-COBURG, ERGO, AXA, Debeka",
    // "versicherung" also inside a name: Musterversicherung, Haftpflichtversicherung.
    pattern: /versicherung|\b(allianz|huk-coburg|ergo|axa|debeka)\b/i,
  },
  { category: "Gebühren", examples: "Rundfunkbeitrag", pattern: /\b(rundfunk|ard zdf)\b/i },
];

/**
 * The category name for a well-known merchant, or null to leave it to the model. Only for money going out: every
 * category here is an expense, and "Deutsche Rentenversicherung" paying a pension is income, not insurance.
 */
export function knownMerchantCategory(counterparty: string, amountCents: number): string | null {
  if (amountCents >= 0) return null;
  return KNOWN_MERCHANTS.find((m) => m.pattern.test(counterparty))?.category ?? null;
}
