// Reads a money amount out of a dictated sentence. The quick capture books a payment from one spoken sentence and
// must not ask back, so this parser is generous: it takes digits, number words ("sieben fünfzig") and dictation
// quirks. The only hard failure is a sentence without any number. A reading that could be wrong is returned with
// certain=false so the caller files the booking under "prüfen" instead of guessing silently.
//
// Known limit: a number of 10–99 right after "Euro" counts as cents, so "5 Euro 20 Minuten Parken" reads 5,20 €.

import { fold, parseNumberWord } from "./number-words";

export type SpokenAmount = { cents: number; certain: boolean };

/** Above this the reading is probably a dictation error ("zweitausend" for "zwanzig"), so it is flagged. */
const MAX_CERTAIN_CENTS = 100_000 * 100;
/** Longer digit runs cannot be money and would leave the safe-integer range after multiplying by 100. */
const MAX_DIGITS = 9;

type Token =
  | { kind: "num"; int: number; frac?: number; word: boolean }
  | { kind: "euro" | "cent" | "und" | "komma" | "article" | "other" };

const TOKEN = /\d{1,2}\.\d{1,2}\.(?:\d{2,4})?|\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?|[a-zäöüß]+|€/g;
const DATE = /^\d{1,2}\.\d{1,2}\.(?:\d{2,4})?$/;
const THOUSANDS = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/;
const DECIMAL = /^(\d+)(?:[.,](\d{1,2}))?$/;

function digitToken(text: string): Token {
  if (DATE.test(text)) return { kind: "other" };
  const thousands = THOUSANDS.exec(text);
  const plain = thousands ? null : DECIMAL.exec(text);
  const intText = thousands ? (thousands[1] ?? "").replaceAll(".", "") : (plain?.[1] ?? "");
  const fracText = thousands ? thousands[2] : plain?.[2];
  if (intText === "" || intText.length > MAX_DIGITS) return { kind: "other" };
  const token: Token = { kind: "num", int: Number.parseInt(intText, 10), word: false };
  if (fracText !== undefined) token.frac = Number.parseInt(fracText.padEnd(2, "0"), 10);
  return token;
}

function wordToken(word: string): Token {
  const folded = fold(word);
  if (folded === "euro" || folded === "eur" || folded === "euros") return { kind: "euro" };
  if (folded === "cent" || folded === "cents" || folded === "ct") return { kind: "cent" };
  if (folded === "und") return { kind: "und" };
  if (folded === "komma") return { kind: "komma" };
  // "ein"/"eine" are mostly articles ("ein Döner"); they only count as a number in front of a unit.
  if (folded === "ein" || folded === "eine") return { kind: "article" };
  const value = parseNumberWord(word);
  if (value === null || value > 999_999_999) return { kind: "other" };
  return { kind: "num", int: value, word: true };
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.toLowerCase().matchAll(TOKEN)) {
    const piece = match[0];
    if (piece === "€") tokens.push({ kind: "euro" });
    else if (/^\d/.test(piece)) tokens.push(digitToken(piece));
    else tokens.push(wordToken(piece));
  }
  return tokens;
}

/** "sieben komma fünf" → 7,50; "drei komma null fünf" → 3,05. Spoken digits after the comma are cents. */
function foldDecimals(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const prev = out[out.length - 1];
    const next = tokens[i + 1];
    if (token?.kind === "komma" && prev?.kind === "num" && prev.frac === undefined && next?.kind === "num") {
      const afterNext = tokens[i + 2];
      if (next.int === 0 && afterNext?.kind === "num" && afterNext.int >= 1 && afterNext.int <= 9) {
        prev.frac = afterNext.int;
        i += 2;
        continue;
      }
      if (next.int >= 1 && next.int <= 99 && next.frac === undefined) {
        prev.frac = next.int < 10 ? next.int * 10 : next.int;
        prev.word = true;
        i += 1;
        continue;
      }
    }
    out.push(token ?? { kind: "other" });
  }
  return out.map((token, i) => {
    const next = out[i + 1];
    if (token.kind === "article" && (next?.kind === "euro" || next?.kind === "cent")) {
      return { kind: "num", int: 1, word: true };
    }
    return token.kind === "article" ? { kind: "other" } : token;
  });
}

function findAmount(tokens: Token[]): SpokenAmount | null {
  const used = new Set<number>();
  const amounts: number[] = [];

  const numAt = (i: number) => {
    const token = tokens[i];
    return token?.kind === "num" && !used.has(i) ? token : null;
  };

  tokens.forEach((token, i) => {
    if (token.kind !== "euro") return;
    const before = numAt(i - 1);
    const source = before ? i - 1 : numAt(i + 1) ? i + 1 : -1;
    const head = numAt(source);
    if (!head) return;
    used.add(source);
    let cents = head.int * 100 + (head.frac ?? 0);
    if (head.frac === undefined && source === i - 1) {
      let j = i + 1;
      if (tokens[j]?.kind === "und") j++;
      const tail = numAt(j);
      const unit = tokens[j + 1]?.kind === "cent";
      if (tail && tail.frac === undefined && tail.int >= 1 && tail.int <= 99 && (unit || tail.int >= 10)) {
        cents += tail.int;
        used.add(j);
        if (unit) used.add(j + 1);
      }
    }
    if (cents > 0) amounts.push(cents);
  });

  tokens.forEach((token, i) => {
    if (token.kind !== "cent") return;
    const before = numAt(i - 1);
    if (before && before.frac === undefined && before.int >= 1 && before.int <= 99 && !used.has(i)) {
      used.add(i - 1);
      amounts.push(before.int);
    }
  });

  if (amounts.length > 0) {
    const cents = amounts.reduce((sum, n) => sum + n, 0);
    return { cents, certain: amounts.length === 1 && cents <= MAX_CERTAIN_CENTS };
  }
  return findUnitless(tokens);
}

/** No "Euro" in the sentence: "Kaffee 3,80", "sieben fünfzig", "hab 7 für Döner". */
function findUnitless(tokens: Token[]): SpokenAmount | null {
  const nums = tokens.flatMap((token) => (token.kind === "num" ? [token] : []));

  const decimals = nums.filter((n) => n.frac !== undefined && n.int * 100 + (n.frac ?? 0) > 0);
  const lastDecimal = decimals[decimals.length - 1];
  if (lastDecimal) {
    return { cents: lastDecimal.int * 100 + (lastDecimal.frac ?? 0), certain: decimals.length === 1 };
  }

  // People say "sieben fünfzig" for 7,50; two number words side by side, the second one 10–99.
  for (let i = tokens.length - 2; i >= 0; i--) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a?.kind === "num" && b?.kind === "num" && a.word && b.word && a.frac === undefined && b.frac === undefined) {
      if (a.int >= 1 && a.int <= 99 && b.int >= 10 && b.int <= 99) return { cents: a.int * 100 + b.int, certain: true };
    }
  }

  const whole = nums.filter((n) => n.int > 0);
  const last = whole[whole.length - 1];
  if (!last) return null;
  // A lone word number may be a count ("zwei Döner"); a lone digit number in a payment sentence is the price.
  return { cents: last.int * 100, certain: whole.length === 1 && !last.word && last.int * 100 <= MAX_CERTAIN_CENTS };
}

export function parseSpokenAmount(text: string): SpokenAmount | null {
  try {
    const result = findAmount(foldDecimals(tokenize(text)));
    if (!result || !Number.isSafeInteger(result.cents) || result.cents <= 0) return null;
    return result;
  } catch {
    // The capture must never fail on odd input; "no amount" sends the sentence to review instead.
    return null;
  }
}
