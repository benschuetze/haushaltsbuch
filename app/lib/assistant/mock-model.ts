import { MockLanguageModelV4 } from "ai/test";

/**
 * Deterministic stand-in for the demo and for tests: picks tools by keyword and phrases an answer from the real
 * tool results. It never invents numbers; everything it says comes from the tools, like the real model should.
 */
type Part = { type: string; text?: string; toolName?: string; output?: { type: string; value: unknown } };
type Message = { role: string; content: string | Part[] };

const usage = {
  inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 0, text: 0, reasoning: undefined },
};

function call(toolName: string, input: object) {
  return {
    content: [
      {
        type: "tool-call" as const,
        toolCallId: `call-${toolName}-${Math.random().toString(36).slice(2, 8)}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

function say(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

type Row = Record<string, unknown>;

function day(iso: unknown): string {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    Date.UTC(y, m - 1, d),
  );
}

function phrase(toolName: string, value: Row): string {
  if (toolName === "heute_verfuegbar") {
    const gehalt = value.naechstesGehalt as Row | null;
    const missing = value.gehaltNochNichtGebucht as Row | null;
    return `Dein Tagesbudget heute: ${value.tagesbudget}. Bis ${gehalt ? `zum Gehalt am ${day(gehalt.am)}` : "Monatsende"} bleiben ${value.freiBisGehalt} für ${value.tageBisGehalt} Tage, Fixkosten und Sparrate schon abgezogen.${missing ? ` Das Gehalt vom ${day(missing.erwartetAm)} ist noch nicht gebucht, deshalb rechne ich vorsichtig ohne.` : ""}`;
  }
  if (toolName === "leisten") {
    const until = value.naechstesGehaltAm ? `bis zum Gehalt am ${day(value.naechstesGehaltAm)}` : "bis Monatsende";
    switch (value.urteil) {
      case "locker":
        return `Ja, locker. ${value.betrag} passen in dein Tagesbudget von ${value.tagesbudgetVorher}.`;
      case "geht":
        return `Ja, geht. Danach bleiben ${until} noch ${value.proTagDanach} pro Tag statt ${value.tagesbudgetVorher}.`;
      case "knapp":
        return `Knapp. Danach bleiben ${until} nur noch ${value.proTagDanach} pro Tag.`;
      default:
        return `Eher nicht. Dann fehlen ${until} ${String(value.freiBisGehaltDanach).replace("−", "")}.`;
    }
  }
  if (toolName === "wann_leisten") {
    if (value.abMonat === null)
      return `Gerade bleibt im Schnitt nichts übrig, deshalb kann ich keinen Monat nennen. ${value.hinweis}`;
    if (value.monateBisDahin === 0) return `Das geht schon jetzt: ${value.jetztFrei} sind bis zum Gehalt frei.`;
    const [y, m] = String(value.abMonat).split("-").map(Number);
    const label = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" }).format(
      Date.UTC(y ?? 2026, (m ?? 1) - 1, 1),
    );
    return `Im ${label}. Im Schnitt bleiben dir ${value.uebrigProMonat} im Monat übrig, damit sind ${value.betrag} in ${value.monateBisDahin} ${value.monateBisDahin === 1 ? "Monat" : "Monaten"} zusammen.`;
  }
  if (toolName === "woche") {
    const streak = Number(value.wochenInFolgeUnterSchnitt ?? 0);
    return `Seit Montag ${value.seitMontag} ausgegeben${value.sonstBisHeute ? `, sonst bis heute ${value.sonstBisHeute}` : ""}.${streak > 0 ? ` Und ${streak} ${streak === 1 ? "Woche" : "Wochen"} in Folge unter Schnitt.` : ""}`;
  }
  if (toolName === "sparziele") {
    const goals = (value.ziele as Row[]) ?? [];
    return goals.length === 0
      ? "Du hast noch kein Sparziel. Unter „Sparziele“ ist eins in zehn Sekunden angelegt."
      : `${goals.map((g) => `${g.name}: ${g.gespart} von ${g.ziel}, ${g.proMonat} im Monat`).join("; ")}.`;
  }
  if (toolName === "naechste_zahlungen") {
    const gehalt = value.naechstesGehalt as Row | null;
    const out = ((value.abgaenge as Row[]) ?? []).map((a) => `${a.was} ${a.betrag} am ${day(a.am)}`);
    return `${gehalt ? `Das nächste Gehalt (${gehalt.betrag}) kommt am ${day(gehalt.am)}.` : "Ein regelmäßiges Gehalt habe ich nicht gefunden."} ${out.length > 0 ? `Bis dahin geht noch ab: ${out.join(", ")}.` : "Bis dahin geht nichts Festes mehr ab."}`;
  }
  if (toolName === "abos_und_fixkosten") {
    const all = (value.zahlungen as Row[]) ?? [];
    const abos = all.filter((z) => z.art === "Abo");
    if (all.length === 0)
      return "Ich habe keine wiederkehrenden Zahlungen gefunden. Dafür braucht es Auszüge aus mehreren Monaten.";
    const hidden = abos.filter((z) => z.kategorie !== "Abos & Software");
    const list = abos.map((z) => `${z.name} (${z.proJahr} im Jahr)`).join(", ");
    return `Ich habe ${abos.length} laufende Abos gefunden: ${list}.${
      hidden.length > 0
        ? ` Nicht als Abo einsortiert und leicht zu übersehen: ${hidden.map((z) => z.name).join(", ")}.`
        : ""
    }`;
  }
  if (toolName === "budgets") {
    const items = (value.budgets as Row[]) ?? [];
    const tight = items.filter((b) => Number(b.prozent) >= 80);
    return tight.length === 0
      ? `Alle ${items.length} Budgets liegen im ${value.monat} unter 80 Prozent.`
      : `Knapp oder drüber im ${value.monat}: ${tight.map((b) => `${b.kategorie} ${b.ausgegeben} von ${b.budget} (${b.prozent} %)`).join(", ")}.`;
  }
  if (toolName === "hinweise") {
    const items = (value.hinweise as Row[]) ?? [];
    return items.length === 0
      ? "Gerade gibt es keine offenen Hinweise."
      : `Offene Hinweise: ${items.map((h) => h.titel).join("; ")}.`;
  }
  if (toolName === "monatsuebersicht") {
    const cats = ((value.kategorien as Row[]) ?? []).filter((c) => String(c.summe).startsWith("−")).slice(0, 3);
    return `Im ${value.monat}: Einnahmen ${value.einnahmen}, Ausgaben ${value.ausgaben}. Größte Posten: ${cats.map((c) => `${c.kategorie} ${c.summe}`).join(", ")}.`;
  }
  if (toolName === "buchungen_suchen") {
    const rows = (value.buchungen as Row[]) ?? [];
    if (rows.length === 0) return "Dazu habe ich keine Buchungen gefunden.";
    return `${rows.length} Treffer, zum Beispiel: ${rows
      .slice(0, 3)
      .map((r) => `${r.datum} ${r.empfaenger} ${r.betrag}`)
      .join("; ")}.`;
  }
  return "Erledigt.";
}

/** The cheeky voice in the demo: one opener per situation, the facts follow unchanged. */
function sass(toolName: string, value: Row): string {
  if (toolName === "leisten") {
    return value.urteil === "nein" ? "Autsch." : value.urteil === "locker" ? "Gönn dir." : "Hm, mutig.";
  }
  if (toolName === "heute_verfuegbar") return "Na, Shoppinglaune?";
  if (toolName === "abos_und_fixkosten") return "Abo-Sammler, was?";
  return "Na gut.";
}

export function createMockAssistantModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const messages = prompt as unknown as Message[];
      const system = messages.find((m) => m.role === "system")?.content;
      const cheeky = typeof system === "string" && system.includes("Ton: frech");
      const last = messages.at(-1);
      if (last?.role === "tool" && Array.isArray(last.content)) {
        const result = last.content.find((p) => p.type === "tool-result");
        const value = (result?.output?.value ?? {}) as Row;
        if (result?.toolName === "monate") {
          const months = (value.monate as string[]) ?? [];
          return months[0] ? call("monatsuebersicht", { monat: months[0] }) : say("Es gibt noch keine Buchungen.");
        }
        const text = phrase(result?.toolName ?? "", value);
        return say(cheeky ? `${sass(result?.toolName ?? "", value)} ${text}` : text);
      }
      const question = [...messages].reverse().find((m) => m.role === "user")?.content;
      const text = (
        typeof question === "string" ? question : (question ?? []).map((p) => p.text ?? "").join(" ")
      ).toLowerCase();
      const amount = /(\d+(?:[.,]\d{1,2})?)\s*(?:€|euro)/.exec(text)?.[1];
      if (amount && /wann/.test(text)) return call("wann_leisten", { betragEuro: Number(amount.replace(",", ".")) });
      if (/sparziel|ziele|sparen für/.test(text)) return call("sparziele", {});
      if (/woche/.test(text) && !/diese woche noch ab/.test(text)) return call("woche", {});
      if (amount && /leisten|kann ich mir|kaufen|drin/.test(text)) {
        return call("leisten", { betragEuro: Number(amount.replace(",", ".")) });
      }
      if (/gehalt|wann kommt|geht noch ab|abgeht|diese woche/.test(text)) return call("naechste_zahlungen", {});
      if (/heute|ausgeben|drin|verfügbar|übrig|frei/.test(text)) return call("heute_verfuegbar", {});
      if (/abo|vertrag|versteckt|wiederkehr|monatlich zahl/.test(text)) return call("abos_und_fixkosten", {});
      if (/budget/.test(text)) return call("budgets", {});
      if (/hinweis|sparen|spar/.test(text)) return call("hinweise", {});
      if (/ausgab|einnahm|übersicht|monat/.test(text)) return call("monate", {});
      const word = /(?:für|bei|von|nach)\s+([a-zäöüß0-9-]{3,})/i.exec(text)?.[1];
      return call("buchungen_suchen", word ? { suchbegriff: word, limit: 5 } : { limit: 5 });
    },
  });
}
