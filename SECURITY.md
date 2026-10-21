# Sicherheit

Das Haushaltsbuch verarbeitet Kontoumsätze. Diese Seite beschreibt, wie die App sie schützt und was der Betreiber selbst tun muss.

## Was die App tut

| Bereich | Maßnahme | Geprüft durch |
|---|---|---|
| Anmeldung | Passwort aus der Umgebung, Vergleich in konstanter Zeit; Session-Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, signiert. Der Server prüft selbst, dass die Sitzung höchstens 7 Tage alt ist und zum aktuellen Passwort gehört: Ein kopiertes Cookie verfällt, ein Passwortwechsel meldet alle Geräte ab. Weiterleitung nach dem Login nur auf eigene Pfade, Steuerzeichen werden abgelehnt (`/<Tab>/evil.example`). Ohne starkes `SESSION_SECRET` (≥ 32 Zeichen) gibt es in Produktion gar keine Sessions. | `auth.test.ts` |
| Passwort raten | Nach 5 Fehlversuchen pro IP (gehasht gespeichert) oder 30 insgesamt sperrt der Login für 15 Minuten, auch für das richtige Passwort. | `login-throttle.test.ts`, `sicherheit.spec.ts` |
| CSRF | Zwei Schichten: React Router lehnt fremde `Origin` ab; zusätzlich prüft die App bei jeder schreibenden Anfrage `Sec-Fetch-Site`, dann `Origin`, dann `Referer` und lehnt ab, wenn keins davon die eigene Seite belegt ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)). | `security.test.ts`, `sicherheit.spec.ts` |
| XSS | Strenge Content-Security-Policy mit Nonce pro Antwort und `strict-dynamic` ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)); Verbindungen, Bilder, Schriften, Medien, Worker und Frames nur zum eigenen Server, damit eingeschleustes Markup nichts nach außen schicken kann. React escaped Ausgaben, KI-Antworten werden als Text angezeigt, nie als HTML. | `security.test.ts`, `sicherheit.spec.ts` (alle Hauptseiten ohne CSP-Verstoß) |
| Header | HSTS, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy: no-referrer`, Permissions-Policy, `noindex`. | `security.test.ts`, `sicherheit.spec.ts` |
| Demo | Eigene Datenbank mit erfundenen Daten, jede schreibende Anfrage 403 (außer Fragen an den Assistenten). Prüfen lässt sich ausprobieren, gespeichert wird nichts. | `zugang.spec.ts`, `pruefen.spec.ts` |
| Eingaben | Zod an allen Eingängen; Regex-Regeln mit verschachtelten Wiederholungen, Alternativen in Wiederholungen oder Rückverweisen werden abgelehnt und, falls schon gespeichert, beim Abgleich übersprungen (ReDoS). Regeln kommen auch vom Regel-Agenten, der Buchungstexte liest. | `rules.test.ts`, `security.test.ts` |
| KI | Nur Empfänger, Zweck, Betrag, Datum; IBANs geschwärzt. Spaltenzuordnung nur mit maskierten Mustern. Fehler werden ohne Anfragetext geloggt. | `llm.test.ts`, `auto.test.ts`, `security.test.ts` |
| Geheimnisse in der Datenbank | AES-256-GCM, Schlüssel nur in der Umgebung (`DATA_ENCRYPTION_KEY`); Manipulation fällt beim Entschlüsseln auf. | `security.test.ts` |
| Bankanbindung | Weiterleitung zur Bank nur über https. Über Enable Banking (lizenzierter Kontoinformationsdienst, FIN-FSA). Nur Lesezugriff, die App sieht nie das Bank-Passwort. Privater Schlüssel nur in der Umgebung, Anfragen mit 10-Minuten-JWT (RS256). Rücksprung nur mit einmaligem, 15 Minuten gültigem `state`, gebunden per Cookie an den Browser, in der Datenbank nur als Hash. Session-ID der Bank nur verschlüsselt gespeichert, beim Trennen bei der Bank widerrufen und gelöscht. Täglicher Abruf nur mit `CRON_SECRET`, Antwort enthält nur Zahlen. | `bank.test.ts`, `bank.spec.ts` (gegen eine Fake-Bank mit echter Signaturprüfung) und einmal von Hand gegen die Sandbox |
| Schnellerfassung | `POST /api/capture` liegt außerhalb der Login-Sitzung und prüft ein eigenes Bearer-Token (`CAPTURE_TOKEN`, mindestens 32 Zeichen, Vergleich zeitkonstant über Hashes). Ohne Token ist der Endpunkt aus (503), in der Demo verweigert er (403). Falsche Bearer-Tokens zählen zur Login-Sperre; Anfragen ganz ohne Bearer-Header nicht, sonst könnte eine fremde Seite die Sperre füllen. Von der CSRF-Prüfung ausgenommen, weil ein Browser den Header nicht von allein sendet. Body höchstens 4 KB, Satz höchstens 500 Zeichen. Der Satz wird nicht geloggt. Entwürfe ohne Betrag bleiben in „prüfen“ und gehen nie ans Modell. Bekannte Grenze: Ein unsicherer, aber gebuchter Betrag verliert sein „prüfen“-Flag, wenn er später per Regel oder von Hand kategorisiert wird; der Nutzer sieht den Betrag bei der Buchung. | `handler.server.test.ts`, `voice-drafts.test.ts`, `security.test.ts`, `auth.test.ts` |
| Assistent | Nur lesende Werkzeuge, kein Schreibzugriff. Werkzeug-Ergebnisse gehen mit geschwärzten IBANs ans Modell. Verlauf höchstens 10 Nachrichten à 1.000 Zeichen, höchstens 60 Fragen am Tag (öffentliche Demo: 30), Antwortlänge begrenzt. | `assistant.test.ts`, `assistent.spec.ts` |
| Kosten | Jeder Modellaufruf zieht von einem Tagesbudget, atomar in einer SQL-Anweisung, damit gleichzeitige Anfragen das Limit nicht überholen: Assistent, Regel-Agent (40) und Kategorisierung (1.000 Buchungen). Darüber landen Buchungen in „prüfen“, statt das Guthaben zu leeren. | `daily-budget.test.ts`, `apply.test.ts` |
| Abhängigkeiten | CI bricht bei bekannten hohen/kritischen Lücken in ausgelieferten Paketen ab; Dependabot wöchentlich; Actions auf Commit-SHA gepinnt, nur Leserechte. | `ci.yml` |
| Repository | Gesamte Git-Historie am 11.10.2026 auf Zugangsdaten durchsucht (API-Keys, private Schlüssel, Datenbank-URLs mit Passwort): keine Treffer. | von Hand |
| Daten | Datenbank und Funktionen in Frankfurt (`fra1`). Echte Kontodaten nie im Repo. | `vercel.json`, `.gitignore` |

## Was der Betreiber tun muss

- Zwei-Faktor-Anmeldung bei GitHub, Vercel, Neon/Vercel-Storage, Anthropic und Enable Banking.
- Geheimnisse (`APP_PASSWORD`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, API-Schlüssel, privater Schlüssel der Bankanbindung) nur in den Vercel-Einstellungen, als „Sensitive“, nie in Chat, Repo oder Datei.
- Bei Verdacht: `APP_PASSWORD` oder `SESSION_SECRET` ändern (beides meldet alle Geräte ab) und betroffene Schlüssel beim Anbieter widerrufen.

## Bekannte Grenzen

- Ein Benutzer, ein Passwort. Keine Mehrbenutzer-Trennung, keine Zwei-Faktor-Anmeldung in der App.
- Sitzungen stehen nur im Cookie, nicht in einer Serverliste: Einzelne Geräte lassen sich nicht gezielt abmelden, nur alle über einen Passwortwechsel.
- Die globale Login-Sperre (30 Fehlversuche in 15 Minuten) kann auch den Besitzer kurz aussperren. Bewusst so: lieber kurz gesperrt als erraten.
- Die 30 täglichen Fragen der öffentlichen Demo kann eine Person allein aufbrauchen.
- Nur im Build, nicht ausgeliefert: `braces@3.0.3` (GHSA-vfj7-8cjw-p6xm, noch kein Patch) und `esbuild@0.18.20` über drizzle-kit (GHSA-67mh-4wv8-2f99, betrifft nur dessen Entwicklungsserver).
- Die private Instanz baut nur für die Produktion, nie als Preview (`scripts/vercel-ignore.mjs`): Eine Preview bekäme eine Kopie der Datenbank und damit echte Kontodaten. Previews gibt es nur für die Demo mit erfundenen Daten.
- Was an die KI geht (Empfänger, Verwendungszweck), verarbeitet Anthropic außerhalb der EU.
- Sentry (falls `SENTRY_DSN` gesetzt) bekommt Fehlername, gekürzte Meldung, Pfad ohne Query und eigene Zählwerte, keine Buchungsinhalte. Ein Bericht kurz vor dem Einfrieren einer Serverless-Funktion kann verloren gehen; der Cron und die Fehlerseite warten nicht überall auf das Senden.
- Die Leitplanken für Claude Code (`.claude/settings.json`, `.claude/hooks/`) greifen bei den Datei-Werkzeugen und bei `git commit`. Ein Shell-Befehl wie `sed -i drizzle/…` umgeht den Pfadschutz; dafür bleiben Review und CODEOWNERS.
- `commit-size.mjs` sagt jeden Commit voraus, bevor der Befehl läuft. Nicht erfasst: Commits aus `merge`, `rebase`, `cherry-pick`, `revert`, `am`, `stash`, Git-Aliasse, `eval`, Pfade in Variablen, Staging über `xargs` oder `--pathspec-from-file`, Commits in Skripten. Schreibzugriffe vor dem Commit sieht er nur bei bekannten Programmen (`rm`, `mv`, `cp`, `sed -i`, `tee`, `git rm`/`checkout` …) und Ausgabe-Umleitungen; Formatierer, Build-Werkzeuge und eigene Skripte nicht. Ein Verzeichnis oder Pfad aus einer Variable führt zur Rückfrage. Ein Shell-Schreibzugriff auf einen Hook wirkt sofort und kann ihn vor jedem Commit abschalten; dafür bleiben CODEOWNERS und das Ruleset. Bekannte, bewusst nicht nachgebaute Lücken der Vorhersage: Klammer-Expansion (`rm -rf .claude/{hooks,x}`), ein im selben Aufruf angelegter Symlink, eine Shell, die ihr Skript von stdin liest (`sh <<EOF`), `cp -t`, `GIT_INDEX_FILE`/`GIT_DIR`, Staging-Pfade aus `$(…)`, `.gitattributes` mit `-diff`/`binary` (zählt 0 Zeilen), ein Rename per `mv` plus `git add -A` im selben Aufruf (zählt doppelt). Die robuste Lösung ist ein git-`pre-commit`-Hook, der den echten Index misst; Umstellung ist ein eigenes Thema.

## Lücke melden

Bitte nicht als öffentliches Issue, sondern per GitHub „Report a vulnerability“ (Security Advisories) an den Repo-Inhaber.
