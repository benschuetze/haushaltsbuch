# CLAUDE.md

Haushaltsbuch: CSV-Kontoauszüge importieren, Buchungen per Regeln und LLM kategorisieren, Monatsübersicht.
Fachliche Details und Datenmodell: `PLAN.md`.

## Stack

React Router 7 (Framework-Modus) · TypeScript strict · Drizzle ORM · Neon Postgres · Vercel · Vercel AI SDK · Tailwind · shadcn/ui · Vitest · PGlite · Playwright · axe-core · Biome · GitHub Actions

## Befehle

```
pnpm dev                 # Entwicklungsserver, Port 5173
pnpm typecheck           # react-router typegen && tsc --noEmit
pnpm lint                # biome check .
pnpm test                # vitest run: Unit- und DB-Tests (PGlite, kein Netz, kein LLM)
pnpm test:e2e            # playwright test: eigener Port 5199, lokales Postgres, LLM gemockt
pnpm check               # typecheck + lint + test + test:e2e
pnpm db:generate         # drizzle-kit generate
pnpm db:migrate          # drizzle-kit migrate
pnpm db:seed             # Standardkategorien und Demo-Konto
pnpm eval                # Eval-Set gegen das echte LLM, braucht ANTHROPIC_API_KEY
```

Vor jedem Commit: `pnpm check`. Schlägt etwas fehl, erst beheben, dann committen.
Nichts als erledigt melden, was nicht gelaufen und gesehen wurde.

## Struktur

```
app/
  routes/                 # eine Datei pro Route, loader/action dort
  components/             # UI, shadcn unter components/ui
  lib/
    db/schema.ts          # einzige Quelle für Tabellen und Typen
    db/client.ts          # neon-http in Produktion, node-postgres lokal/CI, PGlite in Tests
    import/profiles/      # ein Bankprofil pro Datei, Registry in index.ts
    import/normalize.ts
    categorize/rules.ts
    categorize/llm.ts     # Modell wird injiziert, damit Tests ein Mock-Modell übergeben
    money.ts              # Cent-Formatierung und Parsing
tests/
  e2e/                    # Playwright, eine Datei pro Nutzerablauf
  helpers/                # DB-Setup mit PGlite, Fixtures
drizzle/                  # generierte Migrationen, nie von Hand ändern
evals/                    # Eval-Set und Runner
beispieldaten/            # erfundene Demo-Daten und nachgerechnete Erwartungswerte
.claude/skills/           # Arbeitsabläufe für wiederkehrende Aufgaben
```

## Regeln

- Typen kommen aus dem Drizzle-Schema (`$inferSelect`, `$inferInsert`). Keine doppelten Interfaces.
- Alle Eingänge (Formulare, CSV-Zeilen, LLM-Antworten) mit Zod validieren.
- Geld immer als Integer in Cent. Keine Floats, keine Rundung außer in `money.ts` bei der Anzeige.
- Datum als `date` ohne Zeitzone. Monate als `yyyy-mm`.
- Eine Buchung mit `category_source = 'manual'` wird nie automatisch überschrieben.
- Datenzugriff nur in `loader`/`action` oder `app/lib`, nie in Komponenten.
- An das LLM gehen nur `counterparty`, `purpose`, `amount_cents`, `booking_date`. Keine IBAN, keine Kontonummer, kein `raw`.
- Keine echten Kontodaten in Tests, Fixtures oder Commits. Testdaten erfinden.
- UI-Texte auf Deutsch, Code und Bezeichner auf Englisch.
- Kommentare erklären warum, nicht was.
- Echte `<button>`- und `<a>`-Elemente, alles per Tastatur bedienbar.

## Tests

Details und Pflichtfälle: Skill `verify`.

- Jede Änderung an Logik kommt mit Test. Jeder gemeldete Fehler bekommt zuerst einen Test, der ihn zeigt, dann den Fix.
- Tests beschreiben das Versprechen an den Nutzer, nicht die Implementierung.
- Sicherheitsnetz: Beim Import geht keine Zeile still verloren. Jede Zeile ist neu, Duplikat oder mit Grund abgelehnt. Unsichere KI-Ergebnisse landen in „prüfen“, nie in einer geratenen Kategorie.
- Erwartete Summen kommen aus `beispieldaten/erwartet.json`, nie aus dem App-Code selbst.
- Unit- und E2E-Tests rufen nie das echte LLM auf. Das echte LLM läuft nur in `pnpm eval`.
- Selektoren in E2E über Rollen und Beschriftungen, sonst `data-testid`. Keine CSS-Klassen.
- Kein `waitForTimeout` außer mit Kommentar, warum es nicht anders geht.

## Commits und Deploy

- Kleine Commits, Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `test:`).
- Jeder Push läuft durch CI. `main` deployt automatisch auf Vercel, Branches bekommen eine Preview.
- Schema-Änderungen nur über den Skill `db-change`.

## Nicht ohne Rückfrage ändern

- `drizzle/` (generiert)
- `.github/workflows/` (Actions auf Commit-SHA gepinnt, minimale Rechte)
- `beispieldaten/erwartet.json` (von Hand nachgerechnet; wenn ein Test dagegen fehlschlägt, ist zuerst der Code verdächtig)

## Skills

| Skill | Wann |
|---|---|
| `verify` | Tests schreiben, ausführen und UI im Browser prüfen. Bei jeder Änderung. |
| `db-change` | Tabelle oder Spalte ändern |
| `bank-profile` | Neues CSV-Format einer Bank unterstützen |
| `categorizer-eval` | Prompt, Modell oder Kategorien der KI-Zuordnung ändern |
| `ship` | Feature abschließen und deployen |

Neue Skills anlegen, sobald eine Aufgabe zum zweiten Mal gleich abläuft.
