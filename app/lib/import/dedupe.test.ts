import { describe, expect, it } from "vitest";
import { withDedupeHashes } from "./dedupe";
import type { NormalizedRow } from "./types";

const row = (overrides: Partial<NormalizedRow> = {}): NormalizedRow => ({
  line: 2,
  bookingDate: "2026-08-04",
  amountCents: -6312,
  currency: "EUR",
  counterparty: "REWE Markt",
  purpose: "Kartenzahlung girocard",
  raw: {},
  ...overrides,
});

describe("withDedupeHashes", () => {
  it("gleiche Datei zweimal ergibt dieselben Hashes", () => {
    const first = withDedupeHashes("acc", [row(), row({ amountCents: -100 })]).map((r) => r.dedupeHash);
    const second = withDedupeHashes("acc", [row(), row({ amountCents: -100 })]).map((r) => r.dedupeHash);
    expect(second).toEqual(first);
  });

  it("zwei echte gleiche Zahlungen am selben Tag bleiben beide erhalten", () => {
    const [a, b] = withDedupeHashes("acc", [row({ line: 2 }), row({ line: 3 })]);
    expect(a?.dedupeHash).not.toBe(b?.dedupeHash);
  });

  it("dieselbe Buchung auf zwei Konten ist kein Duplikat", () => {
    const [a] = withDedupeHashes("acc-1", [row()]);
    const [b] = withDedupeHashes("acc-2", [row()]);
    expect(a?.dedupeHash).not.toBe(b?.dedupeHash);
  });

  it("die Zeilennummer zählt nicht, nur der Inhalt", () => {
    const [a] = withDedupeHashes("acc", [row({ line: 2 })]);
    const [b] = withDedupeHashes("acc", [row({ line: 40 })]);
    expect(a?.dedupeHash).toBe(b?.dedupeHash);
  });
});
