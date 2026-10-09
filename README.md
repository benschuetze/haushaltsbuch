# Haushaltsbuch

Kontoauszüge als CSV importieren, Buchungen automatisch kategorisieren, Monatsübersicht.

**Demo:** [haushaltsbuch-demo.vercel.app](https://haushaltsbuch-demo.vercel.app) mit erfundenen Beispieldaten, nur lesend und ohne Login.

Die Kategorisierung läuft zweistufig: Zuerst greifen eigene Regeln, für den Rest schlägt ein LLM eine Kategorie vor. Was das Modell nicht sicher weiß, wird nicht geraten, sondern landet in „prüfen“. Jede Korrektur kann mit einem Klick zur Regel werden, damit derselbe Fehler nicht zweimal passiert.

## Problem

Banking-Apps kategorisieren grob und falsch, und man kann sie nicht korrigieren. Excel-Haushaltsbücher scheitern am Abtippen. Hier lädt man einmal im Monat die CSV hoch und prüft nur noch die paar Buchungen, bei denen das System unsicher ist.

## Ablauf einer Buchung

```
CSV ──► Bankprofil ──► Dedupe ──► Regeln ──► LLM ──► Konfidenz ≥ 0,7 ? ──► fertig
         (Zod)        (Hash)     (Priorität)  (nur 4 Felder)     │
                                                                 └──► „prüfen“
Korrektur in der UI ──► manuell (nie wieder überschrieben) ──► optional Regel ──► alle passenden Buchungen neu
```

- **Import ohne Einstellungen:** Kontoauszüge hochladen, auch mehrere auf einmal. Die App erkennt die Bank, ordnet das Konto über die eigene IBAN zu oder legt es an. Ein Format, das sie noch nicht kennt, lernt sie beim ersten Upload: erst kostenlos über die Spaltennamen, nur wenn das nicht reicht mit einem LLM-Aufruf, der ausschließlich Spaltennamen und maskierte Muster sieht (`99.99.9999`, `-999,99`). Gelernte Formate werden gespeichert, dieselbe Bank kostet nie einen zweiten Aufruf.
- **Bankanbindung:** Konten über Enable Banking verbinden (Open Banking nach PSD2, 2.500+ Banken). Die Anmeldung läuft bei der Bank selbst, die App bekommt nur Lesezugriff für bis zu 180 Tage und ruft jeden Morgen automatisch ab; läuft der Zugang ab, meldet sich die Glocke.
- **Bankprofile:** Ein Bankprofil übersetzt das CSV-Format einer Bank. Encoding (UTF-8, BOM, Windows-1252), deutsche Beträge und Datumsangaben werden ohne Float gelesen, alles ist in Cent. Jede Zeile ist danach neu, Duplikat oder mit Zeilennummer und Grund abgelehnt. Keine verschwindet still.
- **Duplikate:** Ein Hash aus Konto, Datum, Betrag, Empfänger und Zweck. Zwei echte, gleiche Kartenzahlungen am selben Tag bleiben beide erhalten, weil Wiederholungen in einer Datei mitgezählt werden.
- **Regeln:** Empfänger oder Verwendungszweck, „enthält“, „ist gleich“ oder Regex. Höhere Priorität gewinnt, bei Gleichstand die ältere Regel.
- **LLM:** Batches à 25 und strukturierter Output über das Vercel AI SDK. Das Modell bekommt nur Empfänger, Zweck, Betrag und Datum, keine IBAN und keine Rohdaten. Jede Antwort wird einzeln geprüft: Bei unbekannter Kategorie, fehlender Antwort, kaputtem JSON oder Netzwerkfehler landet genau diese Buchung in „prüfen“, und der Import läuft trotzdem durch.
- **Manuell schlägt alles:** Eine manuell gesetzte oder bestätigte Kategorie wird weder von Regeln noch vom LLM überschrieben. Das sichert auch die `WHERE`-Klausel des Updates in der Datenbank ab, nicht nur der App-Code.
- **Monatsübersicht:** Einnahmen und Ausgaben je Kategorie mit Vergleich zum Vormonat. Umbuchungen zwischen eigenen Konten zählen weder als Einnahme noch als Ausgabe.

## Datenmodell

`accounts` · `imports` · `categories` · `transactions` · `rules`, Details in [`PLAN.md`](PLAN.md) und [`app/lib/db/schema.ts`](app/lib/db/schema.ts). Das Drizzle-Schema ist die einzige Quelle für Typen, Zod prüft alle Eingänge (Formulare, CSV-Zeilen, LLM-Antworten).

## Stack

React Router 7 (Framework-Modus) · TypeScript strict · Drizzle ORM · Neon Postgres · Vercel · Vercel AI SDK mit Claude · Tailwind · shadcn/ui · Vitest · PGlite · Playwright · axe-core · Biome · GitHub Actions

## Lokal starten

Voraussetzung: Node 22+ und pnpm (`corepack enable`). Ein lokales Postgres ist nicht nötig, PGlite übernimmt.

```bash
pnpm install
cp .env.example .env   # APP_PASSWORD und SESSION_SECRET setzen, AI_MOCK=1 ohne API-Key
pnpm db:local          # Datenbank in .pglite/, migriert und mit Standardkategorien
pnpm dev               # http://localhost:5173
```

## Tests

| Befehl | Was |
|---|---|
| `pnpm test` | Unit- und Datenbanktests mit PGlite im Speicher, ohne Netz und ohne LLM |
| `pnpm test:e2e` | Playwright auf Desktop (Chromium) und iPhone (WebKit), mit Barrierefreiheits-Check (axe) |
| `pnpm eval` | Eval-Set gegen das echte Modell: Trefferquote, Anteil „prüfen“, sichere Fehler |

Die Erwartungswerte für die Demo-Daten stehen in [`beispieldaten/erwartet.json`](beispieldaten/erwartet.json). Sie sind von Hand nachgerechnet und nicht mit dem App-Code erzeugt.

Die wichtigste Zahl im Eval ist „falsch mit Konfidenz ≥ 0,7“. Diese Fehler sieht der Nutzer nicht, weil sie nicht in „prüfen“ landen.

## Grenzen

- Ein Benutzer, Login per Passwort. Für mehrere Haushalte fehlen Mandanten und echte Konten.
- Eingebaute Bankprofile für Sparkasse (CSV-CAMT V2), ING, DKB und Volksbank/Raiffeisenbank, nachgebaut nach den Exportformaten. Andere Banken lernt die App beim ersten Upload; getestet mit nachgebauten Exporten von N26, Deutscher Bank (Soll/Haben), comdirect (Empfänger im Buchungstext) und einem Fantasieformat. Alle Beispieldaten sind erfunden: [`beispieldaten/banken/`](beispieldaten/banken).
- Budgets und das Erkennen wiederkehrender Zahlungen sind geplant, aber noch nicht gebaut.
- Das Modell sieht keine Historie: Eine Buchung, die es letzten Monat richtig hatte, kann es diesen Monat anders einordnen. Regeln machen das stabil.

## Arbeitsweise mit Claude Code

Das Projekt ist mit Claude Code als primärem Werkzeug entstanden. [`CLAUDE.md`](CLAUDE.md) legt Stack, Regeln und Befehle fest, [`.claude/skills/`](.claude/skills) enthält die wiederkehrenden Abläufe:

| Skill | Wofür |
|---|---|
| `verify` | Tests schreiben, ausführen und die UI im Browser prüfen, bei jeder Änderung |
| `db-change` | Schema ändern, Migration erzeugen und auf `DROP` prüfen |
| `bank-profile` | Neues CSV-Format einer Bank unterstützen |
| `categorizer-eval` | Prompt oder Modell ändern und vorher/nachher messen |
| `ship` | Commit, CI, Preview und Produktion prüfen |

Grundsätze: Jeder Fehler bekommt zuerst einen Test, der ihn zeigt. Tests beschreiben das Versprechen an den Nutzer, nicht die Implementierung. Nichts gilt als fertig, was nicht gelaufen und gesehen wurde.
