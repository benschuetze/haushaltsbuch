export type Booking = {
  bookingDate: string;
  amountCents: number;
  counterparty: string;
  purpose: string;
  categoryName: string | null;
};

export type Cadence = "weekly" | "monthly" | "quarterly" | "yearly";

export type Recurring = {
  merchant: string;
  categoryName: string | null;
  cadence: Cadence;
  /** Latest amount, negative like the bookings. */
  lastAmountCents: number;
  previousAmountCents: number | null;
  firstDate: string;
  lastDate: string;
  occurrences: number;
  yearlyCents: number;
  active: boolean;
  /** Fixed costs (rent, insurance) versus subscriptions one could cancel. */
  kind: "subscription" | "fixed";
  /** Same amount every time (within 5 %): a debit that can be planned with, unlike fuel or shopping. */
  stable: boolean;
};

const PER_YEAR: Record<Cadence, number> = { weekly: 52, monthly: 12, quarterly: 4, yearly: 1 };
export const DAYS: Record<Cadence, number> = { weekly: 7, monthly: 30, quarterly: 91, yearly: 365 };
const FIXED_CATEGORIES = new Set(["Wohnen", "Versicherungen", "Kind & Kita", "Mobilität"]);
const NEVER_RECURRING = new Set(["Lebensmittel", "Umbuchung", "Einkommen"]);

// Payment services bundle many shops; the shop is in the purpose ("PP.4471.PP . Thomann GmbH, Ihr Einkauf …").
const AGGREGATOR = /paypal|klarna|amazon payments|sumup|stripe|adyen/i;

export function isAggregator(counterparty: string): boolean {
  return AGGREGATOR.test(counterparty);
}

export function merchantOf(b: Pick<Booking, "counterparty" | "purpose">): string {
  if (isAggregator(b.counterparty)) {
    const shop = /PP\.\d+\.PP\s*\.\s*([^,]+)/i.exec(b.purpose)?.[1] ?? b.purpose.split(",")[0] ?? b.purpose;
    return shop.trim();
  }
  return b.counterparty.trim();
}

/** "Spotify AB" and "SPOTIFY" are the same merchant; legal forms and reference numbers are noise. */
export function merchantKey(name: string): string {
  return name
    .toLowerCase()
    .replace(
      /\b(gmbh|ag|se|ab|inc|ltd|bv|b\.v\.|s\.a\.r\.l\.?|e\.v\.|pbc|kg|co|international|deutschland|europe|eu)\b/g,
      " ",
    )
    .replace(/[^a-zäöüß]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const within5 = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return values.every((v) => Math.abs(v - median) <= median * 0.05);
};

/**
 * Plannable: the same amount every time, or one price change and the same amount since then. A raised
 * subscription is still a fixed cost at its new price; fuel or a shop that differs every time is not.
 */
function atMostOneStep(chronological: number[]): boolean {
  if (within5(chronological)) return true;
  // At least two equal payments before the change, otherwise two different amounts would count as a "step".
  for (let cut = 2; cut < chronological.length; cut++) {
    if (within5(chronological.slice(0, cut)) && within5(chronological.slice(cut))) return true;
  }
  return false;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function cadenceOf(gaps: number[]): Cadence | null {
  const sorted = [...gaps].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median >= 6 && median <= 8) return "weekly";
  if (median >= 26 && median <= 35) return "monthly";
  if (median >= 84 && median <= 98) return "quarterly";
  if (median >= 350 && median <= 380) return "yearly";
  return null;
}

/**
 * Same merchant, regular rhythm, stable amount. Groceries and transfers are left out on purpose:
 * buying bread every week is not a subscription.
 */
export function detectRecurring(bookings: Booking[], referenceDate: string): Recurring[] {
  const groups = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (b.amountCents >= 0 || NEVER_RECURRING.has(b.categoryName ?? "")) continue;
    const key = merchantKey(merchantOf(b));
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }

  const result: Recurring[] = [];
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    const gaps = items.slice(1).map((b, i) => daysBetween(items[i]?.bookingDate ?? b.bookingDate, b.bookingDate));
    const cadence = cadenceOf(gaps);
    if (!cadence) continue;
    // Two bookings in the same week are not a weekly rhythm unless there are more of them.
    if (cadence === "weekly" && items.length < 4) continue;
    // Two equal purchases a month apart are often chance (zoo, bakery). Two payments are enough only for
    // known services or what is already filed as a subscription.
    const last0 = items.at(-1) as Booking;
    if (
      items.length < 3 &&
      last0.categoryName !== "Abos & Software" &&
      !serviceGroupOf(merchantOf(last0), last0.purpose)
    ) {
      continue;
    }

    const amounts = items.map((b) => Math.abs(b.amountCents)).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)] ?? 0;
    if (amounts.some((a) => Math.abs(a - median) > median * 0.25)) continue;

    const last = items.at(-1) as Booking;
    const previous = items.at(-2) ?? null;
    const categoryName = last.categoryName;
    const kind =
      FIXED_CATEGORIES.has(categoryName ?? "") || Math.abs(last.amountCents) > 10_000 ? "fixed" : "subscription";
    result.push({
      merchant: merchantOf(last),
      categoryName,
      cadence,
      lastAmountCents: last.amountCents,
      previousAmountCents: previous?.amountCents ?? null,
      firstDate: items[0]?.bookingDate ?? last.bookingDate,
      lastDate: last.bookingDate,
      occurrences: items.length,
      yearlyCents: Math.abs(last.amountCents) * PER_YEAR[cadence],
      active: daysBetween(last.bookingDate, referenceDate) <= DAYS[cadence] * 1.5,
      kind,
      stable: atMostOneStep(items.map((b) => Math.abs(b.amountCents))),
    });
  }
  return result.sort((a, b) => b.yearlyCents - a.yearlyCents);
}

/** Groups of services that usually replace each other; paying for two is often an oversight. */
export const SERVICE_GROUPS: { name: string; members: RegExp[] }[] = [
  {
    name: "Video-Streaming",
    members: [
      /netflix/,
      /disney/,
      /prime video|amazon prime/,
      /\bwow\b|sky ticket/,
      /paramount/,
      /apple tv/,
      /rtl\+|joyn/,
    ],
  },
  {
    name: "Musik-Streaming",
    members: [/spotify/, /apple music/, /deezer/, /tidal/, /youtube music|youtube premium/, /amazon music/],
  },
  { name: "Cloud-Speicher", members: [/icloud/, /google one|google storage/, /dropbox/, /onedrive|microsoft 365/] },
  { name: "KI-Assistenten", members: [/anthropic|claude/, /openai|chatgpt/, /perplexity/, /mistral|le chat/] },
  { name: "Hörbücher", members: [/audible/, /bookbeat/, /nextory/, /storytel/] },
];

export function serviceGroupOf(merchant: string, purpose = ""): string | null {
  const text = `${merchant} ${purpose}`.toLowerCase();
  return SERVICE_GROUPS.find((g) => g.members.some((m) => m.test(text)))?.name ?? null;
}
