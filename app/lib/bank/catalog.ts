/**
 * The tiles on /banken. Logos are drawn as monograms in the brand colours instead of shipping trademarked
 * image files; PayPal gets its two-P mark because people look for exactly that. Colours are nudged where the
 * original would fail the 4.5:1 text contrast (tested).
 */
export type BankTile = {
  id: string;
  name: string;
  /** Monogram on the tile. */
  mark: string;
  bg: string;
  fg: string;
  /** Finds this bank in the provider's list of German/Austrian banks; null when it is never listed. */
  match: RegExp | null;
  /** How to get statements when there is no live connection. */
  fileHint: string;
  /** Where the export lives, if there is one stable address for it. */
  exportUrl?: string;
};

export const BANK_TILES: BankTile[] = [
  {
    id: "paypal",
    name: "PayPal",
    mark: "PP",
    bg: "#003087",
    fg: "#ffffff",
    // PayPal offers no account access for private customers over PSD2 in Germany.
    match: null,
    fileHint: "Aktivitäten → Kontoauszüge → Aktivitäten herunterladen, Format CSV.",
    exportUrl: "https://www.paypal.com/reports/dlog",
  },
  {
    id: "sparkasse",
    name: "Sparkasse",
    mark: "S",
    bg: "#e2000f",
    fg: "#ffffff",
    match: /sparkasse/i,
    fileHint: "Umsätze → Exportieren → CSV-CAMT V2.",
  },
  {
    id: "dkb",
    name: "DKB",
    mark: "DKB",
    bg: "#0a6ebd",
    fg: "#ffffff",
    match: /^dkb\b|deutsche kreditbank/i,
    fileHint: "Umsätze → Download → CSV.",
  },
  {
    id: "ing",
    name: "ING",
    mark: "ING",
    bg: "#ff6200",
    fg: "#1a1a1a",
    match: /^ing\b|ing-diba/i,
    fileHint: "Umsatzanzeige → Export → CSV.",
  },
  {
    id: "volksbank",
    name: "Volksbank",
    mark: "VR",
    bg: "#0066b3",
    fg: "#ffffff",
    match: /volksbank|raiffeisenbank|vr[ -]?bank/i,
    fileHint: "Umsätze → Exportieren → CSV.",
  },
  {
    id: "n26",
    name: "N26",
    mark: "N26",
    bg: "#1f7a66",
    fg: "#ffffff",
    match: /^n26\b/i,
    fileHint: "Im Web: Konto → Kontoauszüge → CSV herunterladen.",
  },
  {
    id: "comdirect",
    name: "comdirect",
    mark: "cd",
    bg: "#fff500",
    fg: "#000000",
    match: /comdirect/i,
    fileHint: "Umsätze → Export → CSV.",
  },
  {
    id: "consorsbank",
    name: "Consorsbank",
    mark: "C",
    bg: "#007a9e",
    fg: "#ffffff",
    match: /consors/i,
    fileHint: "Umsätze → Export → CSV.",
  },
  {
    id: "cosmosdirekt",
    name: "CosmosDirekt",
    mark: "CD",
    bg: "#0b2d5b",
    fg: "#ffffff",
    match: /cosmos/i,
    fileHint: "Mein CosmosDirekt → Konto → Umsätze exportieren.",
  },
  {
    id: "postbank",
    name: "Postbank",
    mark: "P",
    bg: "#ffcc00",
    fg: "#0a2d6e",
    match: /postbank/i,
    fileHint: "Umsätze → Exportieren → CSV.",
  },
  {
    id: "commerzbank",
    name: "Commerzbank",
    mark: "CB",
    bg: "#ffd700",
    fg: "#002e3c",
    match: /commerzbank/i,
    fileHint: "Umsätze → Export → CSV.",
  },
  {
    id: "deutsche-bank",
    name: "Deutsche Bank",
    mark: "/",
    bg: "#0018a8",
    fg: "#ffffff",
    match: /^deutsche bank/i,
    fileHint: "Umsätze → Export → CSV.",
  },
  {
    id: "amex",
    name: "American Express",
    mark: "AMEX",
    bg: "#016fd0",
    fg: "#ffffff",
    match: /american express|amex/i,
    fileHint: "Umsätze → Herunterladen → CSV.",
  },
  {
    id: "revolut",
    name: "Revolut",
    mark: "R",
    bg: "#0a0a0a",
    fg: "#ffffff",
    match: /revolut/i,
    fileHint: "Konto → Kontoauszug → Excel/CSV.",
  },
  {
    id: "trade-republic",
    name: "Trade Republic",
    mark: "TR",
    bg: "#1a1a1a",
    fg: "#ffffff",
    match: /trade republic/i,
    fileHint: "Profil → Kontoauszüge → als CSV exportieren.",
  },
  {
    id: "easybank",
    name: "easybank",
    mark: "easy",
    bg: "#e2007a",
    fg: "#ffffff",
    match: /easybank/i,
    fileHint: "Umsätze → Export → CSV.",
  },
  {
    id: "barclays",
    name: "Barclays",
    mark: "B",
    bg: "#0071a8",
    fg: "#ffffff",
    match: /barclays/i,
    fileHint: "Umsätze → Export → CSV.",
  },
  {
    id: "wise",
    name: "Wise",
    mark: "W",
    bg: "#9fe870",
    fg: "#163300",
    match: /^wise\b/i,
    fileHint: "Kontoauszüge → CSV herunterladen.",
  },
];

export type TileState = { kind: "direct"; aspsp: string } | { kind: "choose"; aspsps: string[] } | { kind: "file" };

/**
 * One match connects straight away; several (hundreds of Sparkassen) ask which one; none falls back to the
 * file import. Business-only duplicates share a name, so names are de-duplicated first.
 */
export function tileState(tile: BankTile, available: string[]): TileState {
  const hits = [...new Set(available.filter((name) => tile.match?.test(name)))];
  if (hits.length === 1) return { kind: "direct", aspsp: hits[0] as string };
  if (hits.length > 1) return { kind: "choose", aspsps: hits };
  return { kind: "file" };
}
