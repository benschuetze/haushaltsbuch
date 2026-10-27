# Haushaltsbuch für iOS

Eine schlanke, eigenständige iPhone-App: Kontoauszüge (CSV) importieren, Ausgaben per Sprache erfassen, Tagesbudget
sehen, Fragen stellen. **Alles liegt auf dem iPhone.** Es gibt keinen Server, keinen Upload, keine Bankanbindung.
Die Web-App und ihre Datenbank bleiben davon unberührt; die iOS-App teilt mit ihr die Fachlogik, nicht die Daten.

## Was sie kann

| Reiter | Inhalt |
|---|---|
| Heute | Tagesbudget: was bis zum nächsten Gehalt pro Tag bleibt, mit „Wie gerechnet?“ Zeile für Zeile |
| Erfassen | Einen Satz sprechen oder tippen („7 Euro Döner“, „gestern 12,30 bei Rewe“), Buchen, Rückgängig |
| Fragen | Assistent (Claude) mit lesenden Werkzeugen über die lokalen Daten; braucht einen eigenen API-Schlüssel |
| Prüfen | Was die App nicht raten wollte: unbekannte Empfänger, unsichere Beträge, Entwürfe ohne Betrag |
| Import | CSV-Export der Bank aus „Dateien“ wählen; Bank und Spalten werden an der Kopfzeile erkannt |

Datenschutz, konkret:

- Kontoauszug, Buchungen und Regeln liegen als JSON-Datei im Container der App (`Application Support/ledger.json`),
  geschützt bis zur ersten Entsperrung nach dem Neustart, Teil des normalen Geräte-Backups.
- Die Spracherkennung läuft mit `requiresOnDeviceRecognition` auf dem Gerät. Fehlt das deutsche Sprachpaket, wird
  nichts erkannt statt auf Apples Server auszuweichen.
- Der Assistent bekommt die Frage und Werkzeug-Ergebnisse: Summen, Kategorienamen, Termine, Urteile. Nie Empfänger,
  Verwendungszweck, Kontonummern oder Rohzeilen; wiederkehrende Zahlungen werden nach Kategorie benannt.
- Der API-Schlüssel liegt im Keychain (`WhenUnlockedThisDeviceOnly`).

Kategorisierung ohne Modell: eigene Regeln (entstehen beim Prüfen), dann die Händlerliste der Web-App, dazu zwei
Wortlaut-Heuristiken (Gehalt/Kindergeld/Rente → Einkommen, Tagesgeld/Sparrate/Übertrag → Umbuchung). Alles andere
landet in „Prüfen“. Eine Korrektur dort wird zur Regel für den Empfänger und gilt für alle Importe.

## Auf das iPhone bringen

Voraussetzungen: Mac mit **Xcode 16 oder neuer** (App Store, kostenlos, ca. 15 GB), ein iPhone mit iOS 17 oder
neuer, Kabel, Apple-ID. Ein bezahltes Developer-Programm ist nicht nötig; mit der freien Apple-ID läuft die App
sieben Tage, danach einmal neu installieren.

1. Xcode installieren und einmal starten, damit es die iOS-Komponenten nachlädt.
   Danach im Terminal: `sudo xcode-select -s /Applications/Xcode.app`.
2. Xcode › Settings › Accounts › „+“ › Apple-ID anmelden. Xcode legt damit ein Development-Zertifikat an.
3. `ios/Haushaltsbuch.xcodeproj` öffnen. Im Projekt-Navigator das Projekt „Haushaltsbuch“ wählen › Target
   „Haushaltsbuch“ › Signing & Capabilities › bei **Team** das persönliche Team wählen. Automatic Signing bleibt an.
   Schlägt die Bundle-ID fehl (schon vergeben), `de.schuetze.haushaltsbuch` auf etwas Eigenes ändern.
4. iPhone per Kabel anschließen, entsperren, „Diesem Computer vertrauen“. Auf dem iPhone unter
   Einstellungen › Datenschutz & Sicherheit › **Entwicklermodus** einschalten (Neustart).
5. Oben in Xcode das iPhone als Ziel wählen, **⌘R**. Beim ersten Start meldet iOS „Nicht vertrauenswürdiger
   Entwickler“: Einstellungen › Allgemein › VPN & Geräteverwaltung › eigene Apple-ID › Vertrauen.
6. In der App: Import › Datei wählen (CSV vorher in „Dateien“ oder iCloud Drive ablegen oder per AirDrop ans
   iPhone schicken). Unter Prüfen die ersten unbekannten Empfänger zuordnen, vor allem Gehalt → Einkommen, falls die
   Heuristik es nicht erkannt hat; ab zwei Monatsgehältern erkennt die App den Zahltag.
7. Optional: Heute › Zahnrad › Anthropic-API-Schlüssel eintragen, dann antwortet „Fragen“.

Ohne Kabel geht es später auch: Xcode › Window › Devices and Simulators › „Connect via network“.

## Entwickeln ohne Xcode

Die Fachlogik liegt in `Haushaltsbuch/Core/` und benutzt nur Foundation und CryptoKit. Sie lässt sich auf dem Mac
ohne Xcode kompilieren und prüfen (Command Line Tools reichen):

```
ios/scripts/test-core.sh
```

Der Runner `Tests/main.swift` prüft gegen die Zahlen aus den TypeScript-Tests der Web-App und gegen
`beispieldaten/erwartet.json`: Betrags- und Datums-Parser, Bankdateien aller Beispielbanken (Zeilen rein = neu +
Duplikate + abgelehnt + vorgemerkt), die Tagesbudget-Rechnung (Haushalt vom 9. Oktober 2026: 69,58 € pro Tag),
den Sprach-Parser (alle Fälle aus `amount.test.ts`) und den Import des Demo-Auszugs (44 Zeilen, 406.905 Cent).
Die SwiftUI-Schicht in `Haushaltsbuch/App/` braucht das iOS-SDK, also Xcode.

Die Core-Dateien sind Portierungen aus `app/lib/` (money, import/formats/generic, categorize/known-merchants,
budget/available, insights/recurring, capture/amount). Ändert sich dort Logik, wird sie hier nachgezogen und der
Testfall aus der `.test.ts` in `Tests/main.swift` übernommen.

## Grenzen des Prototyps

- Nur CSV. CAMT.053, MT940, PayPal- und Amex-Exporte liest die Web-App, die iOS-App noch nicht.
- Unbekannte CSV-Formate werden nur an den Spaltennamen erkannt; es gibt absichtlich keinen Modell-Fallback.
- Kein Budget je Kategorie, keine Sparziele, keine Abos-Seite, keine Monatsübersicht als Ansicht (der Assistent kann
  sie über `monatsuebersicht` nennen).
- Umbuchungen zwischen eigenen Konten werden erst verknüpft, wenn beide Auszüge importiert sind oder der Wortlaut
  (Tagesgeld, Sparrate …) sie verrät. Verknüpft wird nur zwischen Bankkonten (nie mit Barzahlungen), und eine eigene
  Regel geht vor. Eine Erstattung in gleicher Höhe von einem fremden Konto kann trotzdem als Umbuchung gelten.
- Bekannte Kleinigkeiten ohne Alltagsfall: eine Datei wird beim Import zweimal gelesen; gleich teure wiederkehrende
  Zahlungen haben keine feste Reihenfolge; ein Entwurf ohne Betrag lässt sich mit „Passt so“ mit 0 € bestätigen.
- Das Projekt wurde ohne Xcode geschrieben; die UI-Schicht ist beim ersten Öffnen ungebaut. Compile-Fehler dort sind
  erwartbar klein (Signaturen, Modifier) und in Xcode schnell behoben.
