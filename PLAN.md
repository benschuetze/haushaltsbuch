# Haushaltsbuch – Projektplan

Kontoauszüge als CSV importieren, Buchungen per Regeln und LLM automatisch kategorisieren, Monatsübersicht mit Budgets.

## Funktionsumfang

**Version 1**
- CSV-Import mit Bankprofil, Duplikate werden über einen Hash erkannt
- Regeln anwenden, Rest per LLM kategorisieren (strukturierter Output, nur erlaubte Kategorien, Konfidenz)
- Buchungen mit niedriger Konfidenz als „prüfen“ markieren
- Kategorie manuell ändern, daraus optional eine Regel anlegen
- Monatsübersicht: Ausgaben und Einnahmen je Kategorie
- Demo-Modus mit Beispieldaten (`beispieldaten/`), zum Ausprobieren offen, nachts zurückgesetzt
- Deployment auf Vercel, CI mit GitHub Actions

**Danach**
- Budgets je Kategorie mit Soll/Ist
- Wiederkehrende Zahlungen erkennen (Abos, Verträge)
- Neon-Datenbank per Terraform anlegen

## Stack

- React Router 7 (Framework-Modus), TypeScript strict
- Drizzle ORM, Neon Postgres (Region Frankfurt), `@neondatabase/serverless`
- Vercel AI SDK, `generateObject` mit Zod-Schema, Modell über `AI_MODEL` konfigurierbar (günstiges Modell, z. B. Claude Haiku)
- Tailwind, shadcn/ui
- Vitest für Unit-Tests, PGlite für DB-Tests ohne Netz, Playwright (Desktop und iPhone) für Nutzerabläufe, axe-core für Barrierefreiheit
- GitHub Actions: Typecheck, Lint, Unit- und DB-Tests, E2E gegen Postgres-Service, Actions auf Commit-SHA gepinnt
- Vercel: Preview pro Branch, Produktion auf `main`
- Auth: ein Benutzer, Passwort aus Env, Session-Cookie. Demo-Instanz ohne Login, offen zum Ausprobieren, nachts zurückgesetzt.

## Datenmodell

```
accounts      id, name, bank_profile, created_at
imports       id, account_id → accounts, filename, row_count, imported_at
categories    id, name, kind (expense|income|transfer), color, sort_order
transactions  id, account_id → accounts, import_id → imports,
              booking_date, amount_cents (int, Ausgaben negativ), currency,
              counterparty, purpose, raw (jsonb),
              dedupe_hash (unique),
              category_id → categories (nullable),
              category_source (rule|ai|manual|null),
              ai_confidence (real, nullable), needs_review (bool)
rules         id, field (counterparty|purpose), match_type (contains|equals|regex),
              pattern, category_id → categories, priority,
              created_from_transaction_id → transactions (nullable), created_at
budgets       id, category_id → categories, amount_cents, valid_from (date)   [Version 2]
```

Regeln:
- Beträge immer als Integer in Cent, nie Float
- `dedupe_hash` = Hash aus account_id, booking_date, amount_cents, counterparty, purpose
- Eine manuelle Kategorie wird nie von Regeln oder LLM überschrieben

## Kategorisierung

1. Import normalisiert die Zeilen über das Bankprofil (`app/lib/import/profiles/`)
2. Regeln nach Priorität anwenden, erster Treffer gewinnt, `category_source = rule`
3. Übrige Buchungen in Batches à 25 an das LLM: nur `counterparty`, `purpose`, Betrag, Datum. Keine IBAN, keine Kontonummer.
4. Antwort: `{ id, categoryId, confidence }` je Buchung, Kategorie-IDs nur aus der übergebenen Liste
5. Konfidenz unter 0,7 → `needs_review = true`
6. Korrektur in der UI → `category_source = manual`, Dialog „Regel für diesen Empfänger anlegen?“
7. Eval-Set (`evals/kategorisierung.json`) misst die Trefferquote bei jeder Prompt-Änderung

Standardkategorien: Wohnen, Lebensmittel, Kind & Kita, Mobilität, Versicherungen, Abos & Verträge, Hobbys, Gesundheit, Freizeit, Kleidung, Haushalt, Einkommen, Umbuchung, Sonstiges.

## Import ohne Transaktion

Produktion spricht über `drizzle-orm/neon-http` mit der Datenbank: schnell im Serverless-Betrieb, aber ohne interaktive Transaktionen. Ein Import besteht aus mehreren Schritten (Import-Datensatz, Buchungen in Blöcken, Umbuchungen verknüpfen, kategorisieren, Hinweise). Entscheidung: kein zweiter Treiber mit WebSocket-Pool nur für den Import, sondern Wiederholbarkeit. Buchungen sind über den Dedupe-Hash idempotent; der Import-Datensatz hat einen Status `running`/`done`/`failed`; jeder neue Import (auch der tägliche Bankabruf) kategorisiert zuerst Buchungen aus fehlgeschlagenen oder seit 15 Minuten hängenden Importen nach, ohne Modell landen sie in „prüfen“. So bleibt nach einem Abbruch höchstens bis zum nächsten Import etwas offen, und ein erneuter Upload derselben Datei legt nichts doppelt an. Ein Wechsel auf den Pool-Treiber bleibt möglich, falls einmal echte Atomarität nötig wird (z. B. Buchung und Saldo gemeinsam).

## Seiten

| Route | Inhalt |
|---|---|
| `/` | Aktueller Monat: Summe Einnahmen, Ausgaben, Top-Kategorien, Anzahl „prüfen“ |
| `/import` | Konto wählen, CSV hochladen, Ergebnis: neu, Duplikate, per Regel, per KI, zu prüfen |
| `/buchungen` | Liste mit Filter (Monat, Kategorie, prüfen, unkategorisiert), Kategorie inline ändern |
| `/monat/:yyyy-mm` | Übersicht je Kategorie mit Balken, Vergleich Vormonat |
| `/regeln` | Regeln ansehen, bearbeiten, löschen, Priorität ändern |

## Ablauf

**Samstag**
- Repo anlegen (öffentlich), React Router 7 aufsetzen, Neon-Datenbank und Vercel-Projekt verbinden
- Drizzle-Schema, erste Migration, Seed mit Standardkategorien
- Bankprofil für deine Bank und für `beispieldaten/demo-umsaetze.csv`
- Import mit Dedupe, Seite `/transaktionen`
- GitHub Actions: Typecheck, Lint, Tests

**Sonntag**
- Regeln und LLM-Kategorisierung, Eval-Set laufen lassen
- Korrektur in der UI mit „Regel anlegen“
- Monatsübersicht
- Demo-Instanz mit Beispieldaten deployen
- README: Problem, Datenmodell, Kategorisierung, Grenzen, Agentic-Workflow


## Erster Prompt für Claude Code

`claude` im Projektordner starten und das hier eingeben:

```
Lies PLAN.md und CLAUDE.md. Setz das Projekt auf: React Router 7 im Framework-Modus mit TypeScript strict,
Tailwind, shadcn/ui, Drizzle mit Neon, Vitest, Biome. Leg das Drizzle-Schema aus PLAN.md an,
erzeuge die erste Migration und ein Seed-Script für die Standardkategorien.
Richte Vitest mit PGlite, Playwright und die GitHub-Actions-CI so ein, wie es im Skill verify steht,
und schreib die ersten Tests für money.ts und das Bankprofil der Demo-CSV gegen beispieldaten/erwartet.json.
Halte dich an die Skills in .claude/skills.
Zeig mir vor dem ersten Commit den Plan und die Liste der Dateien.
```

## Tests

Grundsätze: Beim Import verschwindet nichts still, Unsicheres wird zur Prüfung gemeldet statt geraten. E2E-Tests laufen auf eigenem Port auf Desktop und Handy und beschreiben das Versprechen an den Nutzer, nicht die Implementierung. GitHub Actions sind auf Commit-SHA gepinnt.
Pflichtfälle und Konfiguration: `.claude/skills/verify/SKILL.md`. Erwartungswerte für die Demo-Daten: `beispieldaten/erwartet.json`, von Hand nachgerechnet.

## Datenschutz

- Echte Kontodaten nur in deiner privaten Instanz, nie im Repo und nie in der Demo
- `.env` und alle CSVs außerhalb von `beispieldaten/` sind in `.gitignore`
- An das LLM gehen nur Empfänger, Verwendungszweck, Betrag und Datum
