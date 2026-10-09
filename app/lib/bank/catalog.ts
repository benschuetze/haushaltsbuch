/**
 * The tiles on /banken. Logos are the institutions' own app icons, fetched once from their official sites
 * and re-encoded as PNG into public/logos (see README). Order inside a group: roughly by how many people
 * in Germany use them.
 */
export type BankGroup = "bank" | "neobank" | "card" | "payment" | "broker";

export const GROUPS: { id: BankGroup; label: string }[] = [
  { id: "bank", label: "Banken" },
  { id: "neobank", label: "Neobanken" },
  { id: "card", label: "Kreditkarten" },
  { id: "payment", label: "Bezahldienste" },
  { id: "broker", label: "Broker" },
];

export type BankTile = {
  id: string;
  name: string;
  group: BankGroup;
  /** Other names people search for (old brand, parent company). */
  aliases?: string[];
  /** Finds this institution in the provider's list of banks; null when it is never listed. */
  match: RegExp | null;
  /** How to get statements when there is no live connection. */
  fileHint: string;
  /** Where the export lives, if there is one stable address for it. */
  exportUrl?: string;
};

const CSV = "Umsätze → Export → CSV.";

export const BANK_TILES: BankTile[] = [
  {
    id: "paypal",
    name: "PayPal",
    group: "payment",
    // PayPal offers no account access for private customers over PSD2 in Germany.
    match: null,
    fileHint: "Aktivitäten → Kontoauszüge → Aktivitäten herunterladen, Format CSV.",
    exportUrl: "https://www.paypal.com/reports/dlog",
  },
  {
    id: "klarna",
    name: "Klarna",
    group: "payment",
    match: /klarna/i,
    fileHint: "App → Konto → Transaktionen → Export.",
  },

  {
    id: "sparkasse",
    name: "Sparkasse",
    group: "bank",
    match: /sparkasse/i,
    fileHint: "Umsätze → Exportieren → CSV-CAMT V2.",
  },
  {
    id: "volksbank",
    name: "Volksbank",
    group: "bank",
    aliases: ["Raiffeisenbank", "VR-Bank"],
    match: /volksbank|raiffeisenbank|vr[ -]?bank/i,
    fileHint: "Umsätze → Exportieren → CSV.",
  },
  {
    id: "ing",
    name: "ING",
    group: "bank",
    aliases: ["ING-DiBa"],
    match: /^ing\b|ing-diba/i,
    fileHint: "Umsatzanzeige → Export → CSV.",
  },
  {
    id: "dkb",
    name: "DKB",
    group: "bank",
    aliases: ["Deutsche Kreditbank"],
    match: /^dkb\b|deutsche kreditbank/i,
    fileHint: "Umsätze → Download → CSV.",
  },
  { id: "commerzbank", name: "Commerzbank", group: "bank", match: /commerzbank/i, fileHint: CSV },
  { id: "deutsche-bank", name: "Deutsche Bank", group: "bank", match: /^deutsche bank/i, fileHint: CSV },
  { id: "postbank", name: "Postbank", group: "bank", match: /postbank/i, fileHint: "Umsätze → Exportieren → CSV." },
  { id: "comdirect", name: "comdirect", group: "bank", match: /comdirect/i, fileHint: CSV },
  { id: "consorsbank", name: "Consorsbank", group: "bank", match: /consors/i, fileHint: CSV },
  {
    id: "hvb",
    name: "HypoVereinsbank",
    group: "bank",
    aliases: ["HVB", "UniCredit"],
    match: /hypovereinsbank|unicredit/i,
    fileHint: CSV,
  },
  { id: "sparda", name: "Sparda-Bank", group: "bank", match: /sparda/i, fileHint: CSV },
  { id: "psd", name: "PSD Bank", group: "bank", match: /psd bank/i, fileHint: CSV },
  { id: "targobank", name: "Targobank", group: "bank", match: /targobank/i, fileHint: CSV },
  { id: "1822direkt", name: "1822direkt", group: "bank", match: /1822/i, fileHint: CSV },
  { id: "norisbank", name: "norisbank", group: "bank", match: /norisbank/i, fileHint: CSV },
  {
    id: "easybank",
    name: "easybank",
    group: "bank",
    // Took over Barclays' German consumer business; barclays.de leads there now.
    aliases: ["Barclays"],
    match: /easybank|barclays/i,
    fileHint: CSV,
  },
  {
    id: "openbank",
    name: "Openbank",
    group: "bank",
    // Santander's German online bank; santander.de shows the Openbank brand.
    aliases: ["Santander"],
    match: /openbank|santander/i,
    fileHint: CSV,
  },
  { id: "c24", name: "C24", group: "bank", match: /^c24\b/i, fileHint: CSV },
  {
    id: "cosmosdirekt",
    name: "CosmosDirekt",
    group: "bank",
    match: /cosmos/i,
    fileHint: "Mein CosmosDirekt → Konto → Umsätze exportieren.",
  },

  {
    id: "n26",
    name: "N26",
    group: "neobank",
    match: /^n26\b/i,
    fileHint: "Im Web: Konto → Kontoauszüge → CSV herunterladen.",
  },
  { id: "revolut", name: "Revolut", group: "neobank", match: /revolut/i, fileHint: "Konto → Kontoauszug → Excel/CSV." },
  { id: "wise", name: "Wise", group: "neobank", match: /^wise\b/i, fileHint: "Kontoauszüge → CSV herunterladen." },
  { id: "bunq", name: "bunq", group: "neobank", match: /bunq/i, fileHint: "App → Konto → Kontoauszug → CSV." },
  { id: "tomorrow", name: "Tomorrow", group: "neobank", match: /tomorrow/i, fileHint: "App → Kontoauszüge → CSV." },
  { id: "vivid", name: "Vivid", group: "neobank", match: /vivid/i, fileHint: "App → Kontoauszüge → CSV." },

  {
    id: "amex",
    name: "American Express",
    group: "card",
    aliases: ["Amex"],
    match: /american express|amex/i,
    fileHint: "Umsätze → Herunterladen → CSV.",
  },
  {
    id: "mastercard",
    name: "Mastercard",
    group: "card",
    // A card network, not a bank: statements come from the issuing bank.
    match: null,
    fileHint: "Kreditkarten-Portal deiner Bank → Umsätze → CSV.",
  },
  {
    id: "visa",
    name: "Visa",
    group: "card",
    match: null,
    fileHint: "Kreditkarten-Portal deiner Bank → Umsätze → CSV.",
  },
  {
    id: "hanseatic",
    name: "Hanseatic Bank",
    group: "card",
    match: /hanseatic/i,
    fileHint: "Kreditkarte → Umsätze → CSV.",
  },
  { id: "advanzia", name: "Advanzia", group: "card", match: /advanzia/i, fileHint: "Kartenumsätze → Export → CSV." },

  {
    id: "trade-republic",
    name: "Trade Republic",
    group: "broker",
    match: /trade republic/i,
    fileHint: "Profil → Kontoauszüge → als CSV exportieren.",
  },
  {
    id: "scalable",
    name: "Scalable Capital",
    group: "broker",
    match: /scalable/i,
    fileHint: "Transaktionen → Export → CSV.",
  },
];

export type TileState = { kind: "direct"; aspsp: string } | { kind: "choose"; aspsps: string[] } | { kind: "file" };

/**
 * One match connects straight away; several (hundreds of Sparkassen) ask which one; none falls back to the
 * mock connection or the file import. Business-only duplicates share a name, so names are de-duplicated first.
 */
export function tileState(tile: BankTile, available: string[]): TileState {
  const hits = [...new Set(available.filter((name) => tile.match?.test(name)))];
  if (hits.length === 1) return { kind: "direct", aspsp: hits[0] as string };
  if (hits.length > 1) return { kind: "choose", aspsps: hits };
  return { kind: "file" };
}

/** Typing "spark", "barcl" or "amex" finds the tile; case and umlauts do not matter. */
export function matchesSearch(tile: Pick<BankTile, "name" | "aliases">, query: string): boolean {
  const fold = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]/g, "");
  const q = fold(query);
  if (!q) return true;
  return [tile.name, ...(tile.aliases ?? [])].some((n) => fold(n).includes(q));
}
