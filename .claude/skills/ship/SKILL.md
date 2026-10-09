---
name: ship
description: Use when a feature or fix is done and should be committed, pushed and deployed.
---

# Feature abschließen

1. `git diff` lesen. Nichts committen, was nicht zur Aufgabe gehört.
2. Prüfen, dass keine echten Kontodaten, `.env`-Werte oder CSVs außerhalb von `beispieldaten/` im Diff sind.
3. Skill `verify` muss abgeschlossen sein: `pnpm check` grün, UI im Browser angesehen.
4. Bei Schema-Änderungen: Skill `db-change` muss abgeschlossen sein.
5. Commit nach Conventional Commits, eine Änderung pro Commit.
6. Push. CI abwarten mit `gh run watch`. Rot heißt: Ursache finden und fixen, nicht neu starten in der Hoffnung, dass es durchläuft.
7. Preview-URL von Vercel öffnen und die geänderte Stelle ansehen.
8. Auf `main`: Produktions-Deployment abwarten, Produktions-URL aufrufen, geänderte Stelle prüfen.
   - Build-Log: Steht dort „KI-Selbsttest bestanden“? Der Test schickt bei jedem Produktions-Build je eine Mini-Anfrage für Kategorisierung und Spaltenzuordnung an die echte API. Mocks beweisen nur unseren Umgang mit Antworten, nicht dass Key, Workspace, Modell-ID und Ausgabeformat stimmen.
   - Vercel-Logs (Level error/warning) seit dem Deploy lesen. Ein 200 heißt nicht, dass nichts schiefging: Die App fängt LLM-Fehler ab und schreibt sie nur ins Log.
   - Grenzen der Plattform mitdenken: 4,5 MB pro Request, Laufzeit pro Funktion, Region der Funktionen = Region der Datenbank (fra1).
9. Dem Nutzer in einer Zeile sagen, was live ist und wo. Erst wenn es tatsächlich live gesehen wurde.
