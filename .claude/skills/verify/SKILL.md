---
name: verify
description: Use for every code change before calling it done - writing the right tests, running them, and checking the UI in a real browser. Also use when a bug is reported, to first write a failing test that shows it.
---

# Prüfen, bevor etwas fertig ist

## Ablauf

1. Bei einem Fehlerbericht: zuerst einen Test schreiben, der den Fehler zeigt. Er muss rot sein. Dann fixen, dann grün.
2. Bei neuer Funktion: Tests für das Versprechen an den Nutzer schreiben (siehe Pflichtfälle).
3. `pnpm typecheck && pnpm lint && pnpm test`
4. Bei UI-Änderungen zusätzlich `pnpm test:e2e` und die Seite im Browser öffnen (Preview aus `.claude/launch.json` oder Claude in Chrome). Desktop und schmale Breite (390 px) ansehen.
5. Dem Nutzer berichten, was getestet wurde und was im Browser zu sehen war. Nichts melden, was nicht gelaufen ist.

## Testebenen

| Ebene | Werkzeug | Was |
|---|---|---|
| Unit | Vitest | `money.ts`, Bankprofile, Normalisierung, Dedupe-Hash, Regel-Engine, Validierung der LLM-Antwort |
| DB | Vitest + PGlite | Migrationen laufen durch, Unique-Constraint auf `dedupe_hash`, Monatsaggregation, Regel anwenden in der DB |
| KI | Vitest + Mock-Modell aus `ai/test` | Prompt-Aufbau, Umgang mit kaputten oder unvollständigen Antworten |
| E2E | Playwright | Nutzerabläufe im echten Browser, LLM per `AI_MOCK=1` deterministisch |
| Barrierefreiheit | `@axe-core/playwright` | Jede Seite ohne schwere Verstöße |
| Qualität KI | `pnpm eval` | Trefferquote gegen das echte Modell, nur manuell oder per Workflow-Dispatch |

## Pflichtfälle

**Import (Sicherheitsnetz)**
- Zeilen rein = neu + Duplikate + abgelehnt. Keine Zeile verschwindet ohne Grund.
- Summe aller importierten Beträge in Cent = `sum_cents` aus `beispieldaten/erwartet.json`.
- Dieselbe Datei zweimal importieren: zweiter Lauf 0 neu, 44 Duplikate.
- Kaputte Zeile (falsches Datum, Betrag `abc`) wird mit Zeilennummer und Grund abgelehnt, der Rest wird importiert.
- Umlaute, `ISO-8859-1`-Encoding, BOM, Betrag `-1.234,56` und `1.234,56`.

**Kategorisierung**
- Regel schlägt LLM. Höhere Priorität schlägt niedrigere.
- `manual` wird weder von Regeln noch vom LLM überschrieben.
- LLM liefert unbekannte Kategorie-ID, fehlende Buchung oder ungültiges JSON: Buchung bleibt erhalten, landet in `needs_review`, kein Absturz.
- Konfidenz unter 0,7 setzt `needs_review`.
- An das LLM übergebene Daten enthalten kein `raw`, keine IBAN (Test prüft den Prompt-Inhalt).

**Monatsübersicht**
- Einnahmen und Ausgaben je Monat = Werte aus `erwartet.json`, Umbuchungen herausgerechnet.
- Leerer Monat zeigt einen Hinweis, keinen Fehler.

**E2E-Abläufe** (je eine Datei in `tests/e2e/`)
- `import.spec.ts`: Demo-CSV hochladen, Ergebnis zeigt 44 neu; erneut hochladen zeigt 44 Duplikate.
- `korrektur.spec.ts`: Kategorie einer Buchung ändern, „Regel anlegen“ bestätigen, alle Buchungen desselben Empfängers sind umkategorisiert, manuelle bleiben.
- `monat.spec.ts`: Summen für 2026-08 und 2026-09 stimmen mit `erwartet.json` überein.
- `pruefen.spec.ts`: Filter „prüfen“ zeigt nur Buchungen mit `needs_review`, Bestätigen entfernt sie aus dem Filter.
- `zugang.spec.ts`: ohne Login Weiterleitung auf Login; im Demo-Modus wird jeder schreibende Request mit 403 abgelehnt.
- `basis.spec.ts` für jede Route: keine Konsolenfehler, kein horizontaler Überlauf, axe ohne `serious`/`critical`, Hauptaktion per Tastatur erreichbar.

## Playwright-Konfiguration

- Eigener Port 5199 mit `--strictPort`, `webServer` startet die App, `reuseExistingServer` nur lokal.
- Projekte: `desktop` (Chromium 1440×900), `mobile` (iPhone 13, WebKit). Auf dem Handy gibt es kein Hover, Aktionen dürfen nicht davon abhängen.
- `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, `retries` nur in CI.
- Vor dem Lauf: Datenbank leeren, migrieren, seeden. Jede Testdatei startet mit bekanntem Zustand.
- „Sichtbar“ reicht nicht, wenn etwas überdeckt sein kann (Sticky Header, Dialog): mit `elementFromPoint` prüfen, dass das Element wirklich oben liegt.

## Leitplanken (Claude Code Hooks)

- Neue Regel der Art „nicht ohne Rückfrage“ oder „nie von Hand“: nicht nur in CLAUDE.md schreiben, sondern in
  `.claude/hooks/protect-paths.mjs` (Regel) und `.claude/settings.json` (`deny`/`ask`) eintragen. Eine Bitte in
  CLAUDE.md wird übersehen, ein Hook nicht.
- Jede Hook-Änderung mit Test in `tests/hooks/`: erlaubt, blockiert bzw. gefragt, kaputte Eingabe (kein Werfen, Exit 0).
  Gegenprobe: Regel abschalten, Test muss rot werden.
- Hooks ohne Abhängigkeiten, nur `node:`-Module, Pfade mit `path` normalisieren und klein schreiben (macOS/Windows).
- Blockiert der Commit-Hook: aufteilen statt umgehen. Kein `--no-verify`-Ersatz über andere Werkzeuge.
- Prüfpunkte für den Commit-Hook (aus zwei Reviews, Fälle in `tests/hooks/commit-size.test.ts`):
  - Renames zählen einmal (`git mv`, gestagt, auch ein früheres `mv` plus `git add -A`); `git commit <pfad>` ohne `-i`
    misst nur diese Pfade, nicht den Rest des Index; `git add -A <pfad>`, `-p`, `-N` zählen nicht den ganzen Baum.
  - Ein scheiternder git-Aufruf kostet nur seinen Teil, der Index wird immer gemessen; Zustand je Repo, nicht je Zeile.
  - Shell-Zerlegung: `cd $(…)`/Backticks ohne Anführungszeichen, `cd -`/`popd` (unbekannt → Rückfrage), `timeout`,
    `nice`, `$HOME`, Globs gegen das Dateisystem auflösen, Interpreter mit Inline-Code oder Heredoc sind unbekannt.
  - Schreibt ein Befehl vor dem Commit Dateien, die der Commit aus dem Arbeitsbaum nimmt (`git add`, bei `-a` nur
    getrackte), fragt der Hook: deren Größe ist vorher nicht sichtbar.
  - Laufzeit: ein Zeitbudget für alle git-Aufrufe, Zeilen zählen bricht ab, sobald die Grenze überschritten ist.

## Sprach- und Browser-APIs

- Ein spätes oder vorläufiges Ergebnis einer Browser-API darf nach der Aktion, zu der es gehörte, nichts mehr in den
  Zustand schreiben. Testen mit einem Ergebnis, das erst nach dem Absenden eintrifft (Handler beim Absenden kappen).
- Den Fehlercode der API auslesen (`event.error`), statt eine allgemeine Meldung für alles zu zeigen; die Zuordnung
  Code → Text als reine Funktion testen.
- Datenschutztexte auf einer Seite müssen zu dem passen, was der Browser-Hersteller wirklich mit den Daten tut
  (Chrome und Safari schicken Audio an Google bzw. Apple), und zur Seite Datenschutz.

## CI

- Job `check`: typecheck, lint, `pnpm test`.
- Job `e2e`: Postgres als Service-Container, Migrationen, Seed, `pnpm test:e2e`, Playwright-Report und Traces bei Fehlschlag als Artifact hochladen.
- Actions auf Commit-SHA gepinnt, Version als Kommentar daneben. `permissions: contents: read`.
- Install mit `--frozen-lockfile`. Install-Scripts nur für Pakete, die sie brauchen (`pnpm.onlyBuiltDependencies`).
- Workflow `eval` nur per `workflow_dispatch`, mit `ANTHROPIC_API_KEY` als Secret.
