import { describe, expect, it } from "vitest";
import { detectRecurring } from "~/lib/insights/recurring";
import { cancelLinkFor } from "./cancel-links";
import { cancellationStatus } from "./status";

const netflix = (date: string, amount = -1799) => ({
  bookingDate: date,
  amountCents: amount,
  counterparty: "NETFLIX.COM",
  purpose: "Netflix Abo",
  categoryName: "Abos & Software",
});
const history = [netflix("2026-07-03"), netflix("2026-08-03"), netflix("2026-09-03")];
const cancel = { merchantKey: "netflix com", merchant: "NETFLIX.COM", cancelledOn: "2026-09-10" };

describe("Kündigungslinks", () => {
  it("bekannte Dienste führen direkt zur Kündigungsseite", () => {
    expect(cancelLinkFor("NETFLIX.COM")).toEqual({ url: "https://www.netflix.com/cancelplan", direct: true });
    expect(cancelLinkFor("Spotify AB").direct).toBe(true);
    expect(cancelLinkFor("Telekom Deutschland").url).toBe("https://www.telekom.de/kontakt/kuendigung");
    expect(cancelLinkFor("congstar GmbH").url).toContain("congstar.de");
    expect(cancelLinkFor("FitX Deutschland GmbH").url).toBe("https://www.fitx.de/vertrag-kuendigen");
    expect(cancelLinkFor("Telefonica Germany GmbH (o2)").url).toBe("https://info.o2online.de/kuendigung/");
    expect(cancelLinkFor("1&1 Telecom GmbH").url).toContain("1und1.de");
  });

  it("unbekannte führen zur Suche nach dem Kündigungsbutton, Name sauber kodiert", () => {
    const link = cancelLinkFor("Fitness & Co. KG");
    expect(link.direct).toBe(false);
    expect(link.url).toBe("https://duckduckgo.com/?q=Fitness%20%26%20Co.%20KG%20Vertrag%20k%C3%BCndigen");
  });

  it("„Sky“ nur als Wort: eine Skyline-Bar ist kein Sky-Abo", () => {
    expect(cancelLinkFor("Skyline Bar").direct).toBe(false);
  });
});

describe("hat die Kündigung gegriffen?", () => {
  const recurring = detectRecurring(history, "2026-09-10");

  it("vor dem nächsten Fälligkeitstermin: wartet, mit Datum", () => {
    expect(cancellationStatus(cancel, history, recurring, "2026-09-20")).toEqual({
      state: "pending",
      expectedBy: "2026-10-10",
    });
  });

  it("Fälligkeit verstrichen ohne Abbuchung: bestätigt, mit Ersparnis", () => {
    expect(cancellationStatus(cancel, history, recurring, "2026-10-11")).toEqual({
      state: "confirmed",
      yearlyCents: 1799 * 12,
    });
  });

  it("wieder abgebucht: fehlgeschlagen, mit Datum und Betrag", () => {
    const later = [...history, netflix("2026-10-03")];
    expect(cancellationStatus(cancel, later, recurring, "2026-10-05")).toEqual({
      state: "failed",
      chargedOn: "2026-10-03",
      amountCents: -1799,
    });
  });

  it("Abbuchung, die bei der Kündigung schon unterwegs war, zählt nicht", () => {
    const inFlight = [...history, netflix("2026-09-12")];
    expect(cancellationStatus(cancel, inFlight, recurring, "2026-09-20").state).toBe("pending");
  });

  it("Erstattungen und andere Händler zählen nicht als Abbuchung", () => {
    const other = [...history, netflix("2026-10-03", 1799), { ...netflix("2026-10-03"), counterparty: "Spotify AB" }];
    expect(cancellationStatus(cancel, other, recurring, "2026-10-05").state).toBe("pending");
  });
});
