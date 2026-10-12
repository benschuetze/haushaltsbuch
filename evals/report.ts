import type { EvalReport } from "./score";

export type RunInfo = {
  date: string;
  model: string;
  cases: number;
  /** Cases the free merchant list decided, without the model. */
  freeCases: number;
  modelCases: number;
  modelAccuracy: number;
  inputTokens: number;
  outputTokens: number;
};

const pct = (n: number) => `${(n * 100).toFixed(1).replace(".", ",")} %`;

/** The result as Markdown, ready for the README; numbers only from the run, nothing typed by hand. */
export function renderReport(report: EvalReport, run: RunInfo): string {
  const perBooking = run.modelCases ? Math.round((run.inputTokens + run.outputTokens) / run.modelCases) : 0;
  const lines = [
    `Lauf vom ${run.date}, Modell \`${run.model}\`, ${run.cases} erfundene Buchungen.`,
    "",
    "| Kennzahl | Wert |",
    "|---|---|",
    `| Trefferquote gesamt | ${pct(report.accuracy)} |`,
    `| Ohne Modell entschieden (Händlerliste) | ${run.freeCases} von ${run.cases} (${pct(run.freeCases / run.cases)}) |`,
    `| Trefferquote nur Modell | ${pct(run.modelAccuracy)} (${run.modelCases} Buchungen) |`,
    `| Anteil „prüfen“ | ${pct(report.reviewShare)} |`,
    `| Falsch mit Konfidenz ≥ 0,7 (stille Fehler) | ${report.wrongConfident.length} |`,
    `| Tokens pro Buchung ans Modell | ${perBooking} (${run.inputTokens} rein, ${run.outputTokens} raus) |`,
    "",
    "**Kalibrierung** (stimmt die genannte Kategorie, je Konfidenzbereich):",
    "",
    "| Konfidenz | Buchungen | richtig |",
    "|---|---|---|",
    ...report.calibration.map((b) => `| ${b.label} | ${b.cases} | ${b.accuracy === null ? "–" : pct(b.accuracy)} |`),
    "",
    "**Prüfschwelle** (ab welcher Konfidenz die App ohne Nachfrage übernimmt):",
    "",
    "| Schwelle | Anteil „prüfen“ | stille Fehler |",
    "|---|---|---|",
    ...report.thresholds.map(
      (t) => `| ${t.threshold.toFixed(1).replace(".", ",")} | ${pct(t.reviewShare)} | ${t.wrongConfident} |`,
    ),
    "",
    "**Je Kategorie:**",
    "",
    "| Kategorie | Buchungen | richtig |",
    "|---|---|---|",
    ...report.byCategory.map((c) => `| ${c.category} | ${c.cases} | ${pct(c.accuracy)} |`),
  ];
  if (report.confusions.length > 0) {
    lines.push(
      "",
      "**Verwechslungen:**",
      "",
      "| erwartet | bekommen | Anzahl |",
      "|---|---|---|",
      ...report.confusions.map((c) => `| ${c.expected} | ${c.got} | ${c.count} |`),
    );
  }
  return `${lines.join("\n")}\n`;
}
