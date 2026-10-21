import { describe, expect, it } from "vitest";
import { parseSpokenAmount } from "./amount";

type Case = [text: string, cents: number, certain: boolean];

// Invented sentences as a dictation engine or a person would produce them. The promise to the user:
// whatever they say, an amount comes out when there is one, and a doubtful reading is flagged, never silent.
const CERTAIN: Case[] = [
  // digits with a currency marker
  ["7€", 700, true],
  ["7 €", 700, true],
  ["7 Euro", 700, true],
  ["7 euro", 700, true],
  ["7 EUR", 700, true],
  ["EUR 7,50", 750, true],
  ["€7", 700, true],
  ["7,50 Euro", 750, true],
  ["7,50€", 750, true],
  ["7.50€", 750, true],
  ["7.5 Euro", 750, true],
  ["12,5 Euro", 1250, true],
  ["0,99 €", 99, true],
  ["7,- Euro", 700, true],
  ["1.234,56 Euro", 123456, true],
  ["1.234 Euro", 123400, true],
  ["100 Euro", 10000, true],
  ["1 Euro", 100, true],
  ["7 Euro 50", 750, true],
  ["7 Euro und 50 Cent", 750, true],
  ["7 euro 50 cent", 750, true],
  ["3 Euro 5 Cent", 305, true],
  ["3 Euro 2 Döner", 300, true],
  ["50 Cent", 50, true],
  ["50 ct", 50, true],
  ["5 Cent", 5, true],
  // whole sentences
  ["hab grad 7€ für nen döner gezahlt", 700, true],
  ["Hab gerade 7 Euro für Döner bezahlt", 700, true],
  ["habe 2 Döner für 14 Euro gekauft", 1400, true],
  ["Döner 7 Euro", 700, true],
  ["7 Euro Döner", 700, true],
  ["Tanken 54,32 Euro", 5432, true],
  ["bar 7 Euro Döner", 700, true],
  ["Döner sieben Euro", 700, true],
  ["einen Döner für 7 Euro", 700, true],
  ["hab 7 Euro für Döner gezahlt und eine Tüte", 700, true],
  ["hab 7 für Döner gezahlt", 700, true],
  ["Kaffee 3,80", 380, true],
  ["9,99", 999, true],
  ["am 12.10. Döner 7 Euro", 700, true],
  ["sieben Euro achtzig für Brötchen und eine Zeitung", 780, true],
  ["fünf Euro und eine Zeitung", 500, true],
  // number words
  ["sieben Euro", 700, true],
  ["zwei Euro", 200, true],
  ["elf Euro", 1100, true],
  ["zwölf Euro", 1200, true],
  ["sechzehn Euro", 1600, true],
  ["siebzehn Euro", 1700, true],
  ["sechzig Euro", 6000, true],
  ["siebzig Euro", 7000, true],
  ["dreißig Euro", 3000, true],
  ["dreissig Euro", 3000, true],
  ["fuenf Euro", 500, true],
  ["fünf Euro", 500, true],
  ["einundzwanzig Euro", 2100, true],
  ["fünfunddreißig Euro", 3500, true],
  ["hundert Euro", 10000, true],
  ["einhundert Euro", 10000, true],
  ["hundertfünfzig Euro", 15000, true],
  ["zweihundertdreiundvierzig Euro", 24300, true],
  ["tausend Euro", 100000, true],
  ["zweitausend Euro", 200000, true],
  ["ein Euro", 100, true],
  ["ein Euro fünfzig", 150, true],
  ["ein Euro zwanzig", 120, true],
  ["sieben Euro fünfzig", 750, true],
  ["sieben euro und fünfzig cent", 750, true],
  ["fünf Euro zwanzig", 520, true],
  ["fünf Euro und zwanzig Cent", 520, true],
  ["fünf Euro zehn", 510, true],
  ["fünf Euro neunundneunzig", 599, true],
  ["neun Euro neunzig", 990, true],
  ["drei Euro dreißig", 330, true],
  ["sieben Euro und siebenundfünfzig Cent", 757, true],
  ["null Euro fünfzig", 50, true],
  ["fünfzig Cent", 50, true],
  ["zwanzig cent", 20, true],
  ["sieben Euro 50", 750, true],
  ["7 Euro fünfzig", 750, true],
  ["zwei Döner für vierzehn Euro", 1400, true],
  // number words without a unit, as people actually say prices
  ["sieben fünfzig", 750, true],
  ["zwölf neunzig", 1290, true],
  ["ein Döner für sieben fünfzig", 750, true],
  ["sieben komma fünf Euro", 750, true],
  ["sieben komma fünfzig Euro", 750, true],
  ["drei komma neunundneunzig", 399, true],
];

const FLAGGED: Case[] = [
  // two amounts in one sentence: the sum is the best guess, but it is a guess
  ["7 Euro für Döner und 3 Euro für Cola", 1000, false],
  // a bare word number may be a count ("zwei Döner"), so it never counts as sure
  ["hab zwei Döner gekauft", 200, false],
  ["achtzehn", 1800, false],
  // an absurd amount is read, but flagged
  ["2000000 Euro", 200000000, false],
];

const NONE = ["", "   ", "Döner", "ein Döner", "hab einen Döner gekauft", "0 Euro", "null", "Euro", "€", "komma"];

describe("parseSpokenAmount", () => {
  it.each(CERTAIN)("reads %j as %i cents", (text, cents, certain) => {
    expect(parseSpokenAmount(text)).toEqual({ cents, certain });
  });

  it.each(FLAGGED)("reads %j as %i cents but flags it", (text, cents, certain) => {
    expect(parseSpokenAmount(text)).toEqual({ cents, certain });
  });

  it.each(NONE)("finds no amount in %j", (text) => {
    expect(parseSpokenAmount(text)).toBeNull();
  });

  it("round-trips every euro and cent combination written in digits", () => {
    for (let euros = 0; euros <= 999; euros++) {
      for (let cents = 0; cents <= 99; cents += 1) {
        if (euros === 0 && cents === 0) continue;
        const text = `${euros},${String(cents).padStart(2, "0")} Euro`;
        expect(parseSpokenAmount(text)).toEqual({ cents: euros * 100 + cents, certain: true });
      }
    }
  });

  it("never throws and only returns positive integer cents, whatever the input", () => {
    const alphabet = [..."0123456789,.-€ abcdefzüöß\n\t"];
    const words = ["euro", "cent", "und", "komma", "hundert", "tausend", "ein", "fünf", "zig", "\u0000"];
    let seed = 42;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed;
    };
    for (let i = 0; i < 5000; i++) {
      let text = "";
      for (let j = 0; j < 1 + (next() % 12); j++) {
        text += next() % 3 === 0 ? ` ${words[next() % words.length]} ` : alphabet[next() % alphabet.length];
      }
      const result = parseSpokenAmount(text);
      if (result !== null) {
        expect(Number.isSafeInteger(result.cents), JSON.stringify(text)).toBe(true);
        expect(result.cents, JSON.stringify(text)).toBeGreaterThan(0);
      }
    }
  });
});
