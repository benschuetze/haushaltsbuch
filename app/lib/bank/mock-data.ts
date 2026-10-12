/**
 * Invented bookings for banks without a real connection, so the whole flow can be shown: connect, bookings
 * arrive, subscriptions are found, hints appear. Deterministic per bank and day, so tests can rely on it.
 */
export type MockBooking = {
  bookingDate: string;
  amountCents: number;
  counterparty: string;
  purpose: string;
  /** Default category name; null leaves it open for "prüfen". */
  category: string | null;
};

type Monthly = { counterparty: string; purpose: string; cents: number; day: number; category: string };
type Purchase = { counterparty: string; purpose: string; min: number; max: number; category: string | null };

const PROFILES: Record<string, { monthly: Monthly[]; purchases: Purchase[] }> = {
  paypal: {
    monthly: [
      { counterparty: "Netflix", purpose: "Netflix Standard", cents: 1399, day: 12, category: "Abos & Verträge" },
    ],
    purchases: [
      { counterparty: "Zalando SE", purpose: "Bestellung", min: 2990, max: 8990, category: "Kleidung" },
      { counterparty: "eBay", purpose: "Kauf Artikel", min: 899, max: 4500, category: "Sonstiges" },
      {
        counterparty: "Lieferando",
        purpose: "Bestellung",
        min: 1890,
        max: 3490,
        category: "Restaurant & Lieferdienst",
      },
      { counterparty: "Steam", purpose: "Spielekauf", min: 999, max: 2999, category: "Hobbys" },
      { counterparty: "PP*Digitalservice 4471", purpose: "Zahlung", min: 499, max: 1299, category: null },
    ],
  },
  klarna: {
    monthly: [],
    purchases: [
      { counterparty: "H&M", purpose: "Rechnungskauf", min: 1999, max: 5999, category: "Kleidung" },
      { counterparty: "OTTO", purpose: "Ratenkauf", min: 4999, max: 12900, category: "Haushalt" },
      { counterparty: "IKEA", purpose: "Rechnungskauf", min: 2499, max: 18900, category: "Haushalt" },
      { counterparty: "About You", purpose: "Rechnungskauf", min: 2990, max: 6990, category: "Kleidung" },
      { counterparty: "Klarna*Händler 8812", purpose: "Zahlung", min: 990, max: 3990, category: null },
    ],
  },
  amex: {
    monthly: [
      { counterparty: "Disney Plus", purpose: "Disney+ Monatsabo", cents: 999, day: 3, category: "Abos & Verträge" },
      {
        counterparty: "Amazon Prime",
        purpose: "Prime Mitgliedschaft",
        cents: 899,
        day: 21,
        category: "Abos & Verträge",
      },
    ],
    purchases: [
      { counterparty: "Lufthansa", purpose: "Flugticket", min: 12900, max: 28900, category: "Freizeit" },
      { counterparty: "Vapiano", purpose: "Restaurant", min: 2400, max: 5600, category: "Restaurant & Lieferdienst" },
      { counterparty: "Hotel Adlon", purpose: "Übernachtung", min: 18900, max: 18900, category: "Freizeit" },
      { counterparty: "Saturn", purpose: "Elektronik", min: 4999, max: 19900, category: "Haushalt" },
    ],
  },
};

const CARD = {
  monthly: [
    { counterparty: "Apple iCloud", purpose: "iCloud+ 200 GB", cents: 299, day: 15, category: "Abos & Verträge" },
  ],
  purchases: [
    { counterparty: "Booking.com", purpose: "Hotel", min: 8900, max: 24900, category: "Freizeit" },
    { counterparty: "Amazon", purpose: "Bestellung", min: 1299, max: 7999, category: "Haushalt" },
    { counterparty: "Uber", purpose: "Fahrt", min: 1190, max: 3290, category: "Mobilität" },
    {
      counterparty: "Restaurant Da Mario",
      purpose: "Restaurant",
      min: 3200,
      max: 7400,
      category: "Restaurant & Lieferdienst",
    },
    { counterparty: "AUSLANDSEINSATZENTGELT", purpose: "Fremdwährung", min: 120, max: 390, category: "Gebühren" },
    { counterparty: "CRV*Shop 2291", purpose: "Online-Zahlung", min: 990, max: 2990, category: null },
  ],
};

const GENERIC: { monthly: Monthly[]; purchases: Purchase[] } = {
  monthly: [{ counterparty: "FitX", purpose: "Mitgliedsbeitrag", cents: 2499, day: 2, category: "Freizeit" }],
  purchases: [
    { counterparty: "EDEKA", purpose: "Kartenzahlung", min: 1890, max: 8790, category: "Lebensmittel" },
    { counterparty: "dm-drogerie markt", purpose: "Kartenzahlung", min: 690, max: 3290, category: "Haushalt" },
    { counterparty: "Aral Tankstelle", purpose: "Kartenzahlung", min: 4500, max: 8200, category: "Mobilität" },
    { counterparty: "Rossmann", purpose: "Kartenzahlung", min: 450, max: 2190, category: "Haushalt" },
    { counterparty: "Apotheke am Markt", purpose: "Kartenzahlung", min: 790, max: 2490, category: "Gesundheit" },
    { counterparty: "Kartenzahlung 77120", purpose: "POS 77120", min: 1200, max: 4800, category: null },
  ],
};

const CARD_TILES = new Set(["hanseatic", "advanzia"]);

function seedOf(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** mulberry32: tiny, fast and the same on every machine. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Three months up to today: the subscriptions three times (enough to be detected), a dozen purchases. */
export function mockBookings(tileId: string, today: string): MockBooking[] {
  const profile = PROFILES[tileId] ?? (CARD_TILES.has(tileId) ? CARD : GENERIC);
  const rand = random(seedOf(`${tileId}:${today}`));
  const end = new Date(`${today}T00:00:00Z`);
  const out: MockBooking[] = [];

  for (let back = 2; back >= 0; back--) {
    for (const m of profile.monthly) {
      const d = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - back, m.day));
      if (d > end) continue;
      out.push({
        bookingDate: iso(d),
        amountCents: -m.cents,
        counterparty: m.counterparty,
        purpose: m.purpose,
        category: m.category,
      });
    }
  }
  // Known shops at random, plus exactly one unclear booking so "prüfen" has something to show.
  const known = profile.purchases.filter((p) => p.category !== null);
  const unclear = profile.purchases.find((p) => p.category === null);
  for (let i = 0; i < 12; i++) {
    const p = (i === 0 && unclear ? unclear : known[Math.floor(rand() * known.length)]) as Purchase;
    const d = new Date(end.getTime() - Math.floor(rand() * 85) * 86_400_000);
    const cents = p.min + Math.round((rand() * (p.max - p.min)) / 10) * 10;
    out.push({
      bookingDate: iso(d),
      amountCents: -cents,
      counterparty: p.counterparty,
      purpose: `${p.purpose} ${String(1000 + i)}`,
      category: p.category,
    });
  }
  return out.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
}
