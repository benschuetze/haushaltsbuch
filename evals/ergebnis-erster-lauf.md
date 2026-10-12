Lauf vom 2026-10-12, Modell `claude-haiku-5-5`, 203 erfundene Buchungen.

| Kennzahl | Wert |
|---|---|
| Trefferquote gesamt | 93,6 % |
| Ohne Modell entschieden (Händlerliste) | 91 von 203 (44,8 %) |
| Trefferquote nur Modell | 88,4 % (112 Buchungen) |
| Anteil „prüfen“ | 13,8 % |
| Falsch mit Konfidenz ≥ 0,7 (stille Fehler) | 7 |
| Tokens pro Buchung ans Modell | 158 (11682 rein, 5980 raus) |

**Kalibrierung** (stimmt die genannte Kategorie, je Konfidenzbereich):

| Konfidenz | Buchungen | richtig |
|---|---|---|
| 0–0,5 | 17 | 82,4 % |
| 0,5–0,7 | 11 | 72,7 % |
| 0,7–0,9 | 31 | 80,6 % |
| 0,9–1,0 | 144 | 99,3 % |

**Prüfschwelle** (ab welcher Konfidenz die App ohne Nachfrage übernimmt):

| Schwelle | Anteil „prüfen“ | stille Fehler |
|---|---|---|
| 0,5 | 8,4 % | 10 |
| 0,6 | 8,4 % | 10 |
| 0,7 | 13,8 % | 7 |
| 0,8 | 16,3 % | 6 |
| 0,9 | 29,1 % | 1 |

**Je Kategorie:**

| Kategorie | Buchungen | richtig |
|---|---|---|
| Abos & Software | 22 | 100,0 % |
| Einkommen | 14 | 71,4 % |
| Freizeit | 10 | 100,0 % |
| Gebühren | 8 | 100,0 % |
| Gesundheit | 10 | 100,0 % |
| Haushalt | 10 | 100,0 % |
| Haustier | 6 | 83,3 % |
| Hobbys | 13 | 61,5 % |
| Kind & Kita | 10 | 90,0 % |
| Kleidung | 10 | 100,0 % |
| Lebensmittel | 18 | 94,4 % |
| Mobilität | 15 | 100,0 % |
| Restaurant & Lieferdienst | 15 | 100,0 % |
| Sonstiges | 15 | 100,0 % |
| Umbuchung | 7 | 85,7 % |
| Versicherungen | 9 | 100,0 % |
| Wohnen | 11 | 100,0 % |

**Verwechslungen:**

| erwartet | bekommen | Anzahl |
|---|---|---|
| Hobbys | Freizeit | 4 |
| Einkommen | Sonstiges | 2 |
| Einkommen | Gesundheit | 1 |
| Einkommen | Kind & Kita | 1 |
| Haustier | Gebühren | 1 |
| Hobbys | Kleidung | 1 |
| Kind & Kita | Kleidung | 1 |
| Lebensmittel | Restaurant & Lieferdienst | 1 |
| Umbuchung | Sonstiges | 1 |
