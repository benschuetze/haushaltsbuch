---
name: bank-profile
description: Use when the user wants to import a CSV export from a bank whose format is not yet supported, or when an existing bank profile fails to parse a file.
---

# Neues Bankprofil

Die App lernt unbekannte Formate beim Upload selbst (`app/lib/import/formats/`). Ein eingebautes Profil lohnt sich nur, wenn die Erkennung für eine Bank scheitert oder etwas falsch zuordnet (z. B. Gegenpartei steckt im Text). Erst prüfen: Lernt `importAuto` die Beispieldatei richtig? Wenn ja, reicht ein Test in `formats/auto.test.ts`.

Ein Bankprofil übersetzt die CSV einer Bank in das einheitliche Format `NormalizedRow`
(`bookingDate`, `amountCents`, `currency`, `counterparty`, `purpose`, `raw`).

1. Beispieldatei vom Nutzer anfordern. Nur Kopfzeile und 3–5 Zeilen lesen, nicht die ganze Datei ausgeben.
2. Format bestimmen:
   - Trennzeichen (`;` oder `,`), Encoding (oft `ISO-8859-1` oder `UTF-8` mit BOM)
   - Vorspann-Zeilen vor der eigentlichen Kopfzeile
   - Datumsformat (`dd.mm.yyyy` oder `dd.mm.yy`)
   - Betragsformat (`-1.234,56`, separate Soll/Haben-Spalten, Vorzeichen als eigene Spalte)
   - Welche Spalte Empfänger/Auftraggeber und welche Verwendungszweck ist
3. Fixture anlegen: `app/lib/import/profiles/__fixtures__/<bank>.csv` mit erfundenen Werten in exakt diesem Format. Keine echten Daten aus der Beispieldatei übernehmen.
4. Profil in `app/lib/import/profiles/<bank>.ts` anlegen und in `index.ts` registrieren.
5. Test `<bank>.test.ts`: Fixture parsen, mindestens prüfen
   - Anzahl Zeilen
   - eine Ausgabe (negativer Betrag in Cent) und eine Einnahme
   - Datum korrekt
   - Umlaute korrekt
6. `pnpm test` und `pnpm typecheck`.
7. Commit: `feat(import): Bankprofil <Bank>`.

Betrag immer über `parseGermanAmount` aus `app/lib/money.ts` parsen, nie mit `parseFloat`.
