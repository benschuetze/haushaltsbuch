# Sicherheit

Das Haushaltsbuch verarbeitet Kontoumsätze. Diese Seite beschreibt, wie die App sie schützt und was der Betreiber selbst tun muss.

## Was die App tut

| Bereich | Maßnahme | Geprüft durch |
|---|---|---|
| Anmeldung | Passwort aus der Umgebung, Vergleich in konstanter Zeit; Session-Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, signiert, 7 Tage gültig. Ohne starkes `SESSION_SECRET` (≥ 32 Zeichen) gibt es in Produktion gar keine Sessions. | `auth.test.ts` |
| Passwort raten | Nach 5 Fehlversuchen pro IP (gehasht gespeichert) oder 30 insgesamt sperrt der Login für 15 Minuten, auch für das richtige Passwort. | `login-throttle.test.ts`, `sicherheit.spec.ts` |
| CSRF | Zwei Schichten: React Router lehnt fremde `Origin` ab; zusätzlich prüft die App bei jeder schreibenden Anfrage `Sec-Fetch-Site`, dann `Origin`, dann `Referer` und lehnt ab, wenn keins davon die eigene Seite belegt ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)). | `security.test.ts`, `sicherheit.spec.ts` |
| XSS | Strenge Content-Security-Policy mit Nonce pro Antwort und `strict-dynamic` ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)); React escaped Ausgaben. | `sicherheit.spec.ts` |
| Header | HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy, `noindex`. | `security.test.ts`, `sicherheit.spec.ts` |
| Demo | Eigene Datenbank, kein KI-Schlüssel, jede schreibende Anfrage 403. | `zugang.spec.ts` |
| Eingaben | Zod an allen Eingängen; Regex-Regeln mit verschachtelten Wiederholungen werden abgelehnt (ReDoS). | `rules.test.ts`, `security.test.ts` |
| KI | Nur Empfänger, Zweck, Betrag, Datum; IBANs geschwärzt. Spaltenzuordnung nur mit maskierten Mustern. Fehler werden ohne Anfragetext geloggt. | `llm.test.ts`, `auto.test.ts`, `security.test.ts` |
| Geheimnisse in der Datenbank | AES-256-GCM, Schlüssel nur in der Umgebung (`DATA_ENCRYPTION_KEY`); Manipulation fällt beim Entschlüsseln auf. | `security.test.ts` |
| Bankanbindung | Über Enable Banking (lizenzierter Kontoinformationsdienst, FIN-FSA). Nur Lesezugriff, die App sieht nie das Bank-Passwort. Privater Schlüssel nur in der Umgebung, Anfragen mit 10-Minuten-JWT (RS256). Rücksprung nur mit einmaligem, 15 Minuten gültigem `state`, gebunden per Cookie an den Browser, in der Datenbank nur als Hash. Session-ID der Bank nur verschlüsselt gespeichert, beim Trennen bei der Bank widerrufen und gelöscht. Täglicher Abruf nur mit `CRON_SECRET`, Antwort enthält nur Zahlen. | `bank.test.ts`, `bank.spec.ts` (gegen eine Fake-Bank mit echter Signaturprüfung) und einmal von Hand gegen die Sandbox |
| Assistent | Nur lesende Werkzeuge, kein Schreibzugriff. Werkzeug-Ergebnisse gehen mit geschwärzten IBANs ans Modell. Verlauf höchstens 10 Nachrichten à 1.000 Zeichen, höchstens 60 Fragen am Tag, Antwortlänge begrenzt. In der Demo antwortet ein Testmodell ohne Kosten. | `assistant.test.ts`, `assistent.spec.ts` |
| Abhängigkeiten | CI bricht bei bekannten hohen/kritischen Lücken in ausgelieferten Paketen ab; Dependabot wöchentlich. | `ci.yml` |
| Daten | Datenbank und Funktionen in Frankfurt (`fra1`). Echte Kontodaten nie im Repo. | `vercel.json`, `.gitignore` |

## Was der Betreiber tun muss

- Zwei-Faktor-Anmeldung bei GitHub, Vercel, Neon/Vercel-Storage, Anthropic und Enable Banking.
- Geheimnisse (`APP_PASSWORD`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, API-Schlüssel, privater Schlüssel der Bankanbindung) nur in den Vercel-Einstellungen, als „Sensitive“, nie in Chat, Repo oder Datei.
- Bei Verdacht: `SESSION_SECRET` ändern (meldet alle Geräte ab) und betroffene Schlüssel beim Anbieter widerrufen.

## Bekannte Grenzen

- Ein Benutzer, ein Passwort. Keine Mehrbenutzer-Trennung.
- Die private Instanz baut nur für die Produktion, nie als Preview (`scripts/vercel-ignore.mjs`): Eine Preview bekäme eine Kopie der Datenbank und damit echte Kontodaten. Previews gibt es nur für die Demo mit erfundenen Daten.
- Was an die KI geht (Empfänger, Verwendungszweck), verarbeitet Anthropic außerhalb der EU.

## Lücke melden

Bitte nicht als öffentliches Issue, sondern per GitHub „Report a vulnerability“ (Security Advisories) an den Repo-Inhaber.
