---
name: ios-app
description: Use when changing the iOS app under ios/ (Swift core, SwiftUI views, Xcode project), porting logic from app/lib to Swift, or when Ben asks to build or install the iPhone app.
---

# iOS-App (ios/)

Eigenständige SwiftUI-App ohne Server: alles bleibt auf dem iPhone. Einstieg und Installationsschritte: `ios/README.md`.

## Aufbau

- `ios/Haushaltsbuch/Core/` – reine Fachlogik, nur Foundation + CryptoKit, kompiliert auf dem Mac ohne Xcode.
  Portierungen aus `app/lib/`: Money ↔ `money.ts`, Import ↔ `import/formats/generic.ts` + `profiles/shared.ts`,
  Categorize ↔ `categorize/known-merchants.ts` + `rules.ts`, Budget ↔ `budget/available.ts` + `insights/recurring.ts`,
  SpokenAmount ↔ `capture/amount.ts` + `number-words.ts` + `counterpartyFrom` aus `capture/run.ts`.
- `ios/Haushaltsbuch/App/` – SwiftUI, Store (JSON-Datei), Speech, Assistent (rohes HTTP gegen `/v1/messages`).
- `ios/Tests/main.swift` – Test-Runner, `ios/scripts/test-core.sh` kompiliert und startet ihn.
- `ios/Haushaltsbuch.xcodeproj` – von Hand geschrieben, Xcode-16-Format mit synchronisiertem Ordner: neue Swift-Dateien
  unter `Haushaltsbuch/` werden automatisch Teil des Targets, die pbxproj muss dafür nicht angefasst werden.

## Ablauf bei Änderungen

1. Logik ändert sich in `app/lib`? Dieselbe Änderung in der Swift-Portierung nachziehen und den Testfall aus der
   `.test.ts` in `Tests/main.swift` übernehmen. Erwartungswerte kommen aus den TS-Tests oder `beispieldaten/erwartet.json`,
   nie aus dem Swift-Code.
2. `ios/scripts/test-core.sh` muss „OK“ melden. Ohne Xcode ist das die einzige Prüfung der Fachlogik; die UI-Schicht
   kompiliert nur in Xcode.
3. `pnpm lint` läuft weiter (Biome ignoriert `ios/`), die Web-Tests bleiben unberührt.
4. Commits unter 400 Zeilen: Core, Tests, App und Projektdateien getrennt committen.

## Fallstricke

- Swift-`Character` fasst `"\r\n"` zu einem Zeichen zusammen: Parser über `unicodeScalars` laufen lassen, sonst
  erkennt der CSV-Parser Windows-Zeilenenden nicht (Sparkasse, Volksbank, Deutsche Bank).
- `swiftc` im Sandbox-Bash braucht `-module-cache-path` innerhalb von `$TMPDIR`; der Fehler zu `xcrun_db` ist nur Rauschen.
- Test-Ausgabe mit `setvbuf(stdout, nil, _IONBF, 0)` ungepuffert halten, sonst verschluckt ein Crash die FAIL-Zeilen davor.
- `JSONSerialization` lehnt Swift-Optionals ab: fehlende Werte als `NSNull()`; leere Dictionaries als `[String: Any]()`.
- Toolbar-Einträge müssen innerhalb des `NavigationStack` stehen, sonst erscheinen sie nicht.
- Datenschutz-Regel der App: an das Modell gehen nur Summen, Kategorienamen, Termine und Urteile. Kein Werkzeug darf
  `counterparty`, `purpose`, Kontonummern oder Rohzeilen zurückgeben. Die Spracherkennung bleibt bei
  `requiresOnDeviceRecognition = true`.
- `erwartet.json`: `expense_cents` enthält die Umbuchungen; die App weist sie getrennt aus (`transfer_cents`).
