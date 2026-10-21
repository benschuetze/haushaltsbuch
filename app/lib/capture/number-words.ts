// German number words ("einundzwanzig", "zweihundertdreiundvierzig") as integers. Split from amount.ts so the
// word grammar can be tested on its own against an independent generator.

const UNITS: Record<string, number> = {
  eins: 1,
  ein: 1,
  eine: 1,
  zwei: 2,
  drei: 3,
  vier: 4,
  funf: 5,
  sechs: 6,
  sieben: 7,
  acht: 8,
  neun: 9,
  zehn: 10,
  elf: 11,
  zwolf: 12,
  dreizehn: 13,
  vierzehn: 14,
  funfzehn: 15,
  sechzehn: 16,
  siebzehn: 17,
  achtzehn: 18,
  neunzehn: 19,
};
const TENS: Record<string, number> = {
  zwanzig: 20,
  dreissig: 30,
  vierzig: 40,
  funfzig: 50,
  fuffzig: 50,
  sechzig: 60,
  siebzig: 70,
  achtzig: 80,
  neunzig: 90,
};
// Longest first, otherwise "sechs" would shadow "sechzehn" and "drei" would shadow "dreizehn".
const ATOMS = [...Object.keys(UNITS), ...Object.keys(TENS), "hundert", "tausend", "und"].sort(
  (a, b) => b.length - a.length,
);

/** Dictation writes "fünf", people type "fuenf"; both fold to the same ASCII form. */
export function fold(word: string): string {
  return word
    .replaceAll("ä", "a")
    .replaceAll("ö", "o")
    .replaceAll("ü", "u")
    .replaceAll("ß", "ss")
    .replaceAll("ae", "a")
    .replaceAll("oe", "o")
    .replaceAll("ue", "u");
}

/** One German number word ("einundzwanzig", "zweihundertdreiundvierzig") → integer, or null if it is not one. */
export function parseNumberWord(raw: string): number | null {
  const word = fold(raw);
  if (word === "null") return 0;
  let pos = 0;
  let total = 0;
  let current = 0;
  let pending = 0;
  let afterUnd = false;
  let consumed = 0;
  while (pos < word.length) {
    const atom = ATOMS.find((a) => word.startsWith(a, pos));
    if (!atom) return null;
    pos += atom.length;
    consumed++;
    if (atom === "und") {
      if (pending === 0 || afterUnd) return null;
      afterUnd = true;
    } else if (atom in UNITS) {
      if (pending > 0 || afterUnd) return null;
      pending = UNITS[atom] ?? 0;
    } else if (atom in TENS) {
      if (pending > 0 && !afterUnd) return null;
      if (afterUnd && pending === 0) return null;
      current += pending + (TENS[atom] ?? 0);
      pending = 0;
      afterUnd = false;
    } else if (atom === "hundert") {
      if (current > 0 || afterUnd) return null;
      current = (pending || 1) * 100;
      pending = 0;
    } else {
      if (afterUnd) return null;
      total += (current + pending || 1) * 1000;
      current = 0;
      pending = 0;
    }
  }
  if (consumed === 0 || afterUnd) return null;
  return total + current + pending;
}
