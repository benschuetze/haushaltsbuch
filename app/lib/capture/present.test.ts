import { describe, expect, it } from "vitest";
import type { Transaction } from "~/lib/db/schema";
import { describeBooking } from "./present";
import type { CaptureResult } from "./run";

const NOW = new Date("2026-10-21T10:00:00Z");

function result(over: Partial<Transaction>, rest: Partial<CaptureResult> = {}): CaptureResult {
  return {
    created: true,
    draft: false,
    categoryName: "Restaurant & Lieferdienst",
    transaction: {
      id: "11111111-1111-4111-8111-111111111111",
      bookingDate: "2026-10-21",
      amountCents: -700,
      counterparty: "Döner",
      captureText: "hab grad 7 Euro für nen Döner gezahlt",
      needsReview: false,
      ...over,
    } as Transaction,
    ...rest,
  };
}

describe("describeBooking", () => {
  it("zeigt Betrag ohne Vorzeichen, Empfänger, Kategorie und „heute“", () => {
    expect(describeBooking(result({}), NOW)).toMatchObject({
      amountLabel: "7,00 €",
      counterparty: "Döner",
      sentence: "hab grad 7 Euro für nen Döner gezahlt",
      categoryLabel: "Restaurant & Lieferdienst",
      dayLabel: "heute",
      needsReview: false,
      draft: false,
    });
  });

  it("nennt gestern, vorgestern und sonst das Datum; „heute“ zählt nach Berliner Zeit", () => {
    expect(describeBooking(result({ bookingDate: "2026-10-20" }), NOW).dayLabel).toBe("gestern");
    expect(describeBooking(result({ bookingDate: "2026-10-19" }), NOW).dayLabel).toBe("vorgestern");
    expect(describeBooking(result({ bookingDate: "2026-10-01" }), NOW).dayLabel).toBe("01.10.2026");
    // 22:30 UTC is already 00:30 on the 22nd in Berlin.
    expect(describeBooking(result({ bookingDate: "2026-10-22" }), new Date("2026-10-21T22:30:00Z")).dayLabel).toBe(
      "heute",
    );
  });

  it("ohne gespeicherten Satz steht der Empfänger dort", () => {
    expect(describeBooking(result({ captureText: null }), NOW).sentence).toBe("Döner");
  });

  it("ein Entwurf hat keinen Betrag und keine Kategorie", () => {
    const card = describeBooking(
      result({ amountCents: 0, needsReview: true }, { draft: true, categoryName: null }),
      NOW,
    );
    expect(card).toMatchObject({ amountLabel: null, categoryLabel: null, draft: true, needsReview: true });
  });
});
