import { describe, expect, it } from "vitest";
import { cancelLetter, referencesFrom } from "./cancel-letter";

describe("Nummern aus der Buchung", () => {
  it.each([
    ["Mitgliedsbeitrag 10/2026 Mitgliedsnr. 004711", { label: "Mitgliedsnummer", value: "004711" }],
    ["Kd-Nr. 12345678 Rechnung Oktober", { label: "Kundennummer", value: "12345678" }],
    ["Kundennummer: K-998877 Beitrag", { label: "Kundennummer", value: "K-998877" }],
    ["Vertragsnr 5500/2231 Monatsrate", { label: "Vertragsnummer", value: "5500/2231" }],
    ["VERS.-NR. LV 12-345.678 Beitrag", { label: "Versicherungsnummer", value: "LV 12-345.678" }],
  ])("%s", (purpose, expected) => {
    expect(referencesFrom(purpose, {}).numbers).toContainEqual(expected);
  });

  it("Mandatsreferenz aus dem Verwendungszweck oder aus der Bank-Spalte", () => {
    expect(referencesFrom("Beitrag MREF: FIT-2231-77 CRED: DE98ZZZ09999999999", {}).mandate).toBe("FIT-2231-77");
    expect(referencesFrom("Beitrag", { Mandatsreferenz: "M-0042" }).mandate).toBe("M-0042");
  });

  it("rät nichts: unbeschriftete Zahlen, Beträge und IBANs werden nicht zu Kundennummern", () => {
    const r = referencesFrom("Beitrag 10/2026 49,90 EUR DE89370400440532013000 Danke 123456", {});
    expect(r.numbers).toEqual([]);
    expect(r.mandate).toBeNull();
  });
});

const sender = { name: "Alex Beispiel", street: "Musterweg 1", city: "12345 Musterstadt", email: "" };
const recipient = { name: "Fitness & Co. KG", address: "Studiostraße 5\n54321 Sportstadt" };

describe("Kündigungsschreiben", () => {
  it("ordentliche Kündigung zum nächstmöglichen Zeitpunkt, mit Bitte um Bestätigung des Vertragsendes", () => {
    const r = cancelLetter({
      sender,
      recipient,
      numbers: [{ label: "Mitgliedsnummer", value: "004711" }],
      mandate: "FIT-2231-77",
      date: "2026-10-11",
    });
    if (!r.ok) throw new Error(r.missing.join());
    expect(r.subject).toBe("Kündigung – Mitgliedsnummer 004711");
    expect(r.text).toContain("Alex Beispiel\nMusterweg 1\n12345 Musterstadt");
    expect(r.text).toContain("Fitness & Co. KG\nStudiostraße 5\n54321 Sportstadt");
    expect(r.text).toContain("Musterstadt, 11. Oktober 2026");
    expect(r.text).toContain(
      "hiermit kündige ich den oben genannten Vertrag fristgerecht zum nächstmöglichen Zeitpunkt.",
    );
    expect(r.text).toContain(
      "Bitte bestätigen Sie mir den Eingang dieser Kündigung und das genaue Vertragsende schriftlich.",
    );
    expect(r.text).toContain(
      "Das SEPA-Lastschriftmandat mit der Mandatsreferenz FIT-2231-77 widerrufe ich zum Vertragsende.",
    );
    expect(r.text.trim().endsWith("Alex Beispiel")).toBe(true);
  });

  it("ohne Mandatsreferenz kein Satz über das Mandat, ohne Nummer ein schlichter Betreff", () => {
    const r = cancelLetter({ sender, recipient, numbers: [], mandate: null, date: "2026-10-11" });
    if (!r.ok) throw new Error(r.missing.join());
    expect(r.subject).toBe("Kündigung meines Vertrags");
    expect(r.text).not.toContain("Lastschriftmandat");
  });

  it("ohne Absender oder Empfänger-Anschrift gibt es kein Schreiben, sondern die Liste, was fehlt", () => {
    const r = cancelLetter({
      sender: { ...sender, street: " " },
      recipient: { ...recipient, address: "" },
      numbers: [],
      mandate: null,
      date: "2026-10-11",
    });
    expect(r).toEqual({ ok: false, missing: ["Straße und Hausnummer", "Anschrift des Anbieters"] });
  });
});
