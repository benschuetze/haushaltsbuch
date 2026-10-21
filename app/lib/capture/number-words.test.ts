import { describe, expect, it } from "vitest";
import { parseNumberWord } from "./number-words";

describe("parseNumberWord", () => {
  it("reads every number word from 1 to 999", () => {
    for (let n = 1; n <= 999; n++) {
      expect(parseNumberWord(toGermanWords(n)), `${n} → ${toGermanWords(n)}`).toBe(n);
    }
  });

  it("reads thousands and the ASCII spellings dictation sometimes produces", () => {
    expect(parseNumberWord("tausend")).toBe(1000);
    expect(parseNumberWord("zweitausend")).toBe(2000);
    expect(parseNumberWord("fuenf")).toBe(5);
    expect(parseNumberWord("dreissig")).toBe(30);
    expect(parseNumberWord("zwoelf")).toBe(12);
    expect(parseNumberWord("null")).toBe(0);
  });

  it.each(["", "döner", "einen", "zweidrei", "undzwanzig", "zweiund", "hundertzweihundert", "zig", "achtung"])(
    "rejects %j",
    (word) => {
      expect(parseNumberWord(word)).toBeNull();
    },
  );
});

const UNITS = [
  "",
  "ein",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
];
const TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];

// Independent of the parser on purpose: the test must not share the parser's idea of German numbers.
function toGermanWords(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = hundreds > 0 ? `${UNITS[hundreds]}hundert` : "";
  if (rest === 0) return head;
  if (rest < 20) return head + (rest === 1 ? "eins" : UNITS[rest]);
  const tens = TENS[Math.floor(rest / 10)];
  const unit = rest % 10;
  return head + (unit === 0 ? tens : `${UNITS[unit]}und${tens}`);
}
