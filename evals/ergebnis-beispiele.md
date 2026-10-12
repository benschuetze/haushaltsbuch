Lauf vom 2026-10-12, Modell `claude-haiku-5-5, mit Beispielen (Leave-one-out)`, 203 erfundene Buchungen.

| Kennzahl | Wert |
|---|---|
| Trefferquote gesamt | 99,0 % |
| Ohne Modell entschieden (Händlerliste) | 91 von 203 (44,8 %) |
| Trefferquote nur Modell | 98,2 % (112 Buchungen) |
| Anteil „prüfen“ | 9,4 % |
| Falsch mit Konfidenz ≥ 0,7 (stille Fehler) | 0 |
| Tokens pro Buchung ans Modell | 231 (18608 rein, 7270 raus) |

**Kalibrierung** (stimmt die genannte Kategorie, je Konfidenzbereich):

| Konfidenz | Buchungen | richtig |
|---|---|---|
| 0–0,5 | 15 | 93,3 % |
| 0,5–0,7 | 4 | 75,0 % |
| 0,7–0,9 | 22 | 100,0 % |
| 0,9–1,0 | 162 | 100,0 % |

**Prüfschwelle** (ab welcher Konfidenz die App ohne Nachfrage übernimmt):

| Schwelle | Anteil „prüfen“ | stille Fehler |
|---|---|---|
| 0,5 | 7,4 % | 1 |
| 0,6 | 7,4 % | 1 |
| 0,7 | 9,4 % | 0 |
| 0,8 | 12,8 % | 0 |
| 0,9 | 20,2 % | 0 |

**Je Kategorie:**

| Kategorie | Buchungen | richtig |
|---|---|---|
| Abos & Verträge | 22 | 100,0 % |
| Einkommen | 14 | 100,0 % |
| Freizeit | 10 | 100,0 % |
| Gebühren | 8 | 87,5 % |
| Gesundheit | 10 | 100,0 % |
| Haushalt | 10 | 100,0 % |
| Haustier | 6 | 100,0 % |
| Hobbys | 13 | 92,3 % |
| Kind & Kita | 10 | 100,0 % |
| Kleidung | 10 | 100,0 % |
| Lebensmittel | 18 | 100,0 % |
| Mobilität | 15 | 100,0 % |
| Restaurant & Lieferdienst | 15 | 100,0 % |
| Sonstiges | 15 | 100,0 % |
| Umbuchung | 7 | 100,0 % |
| Versicherungen | 9 | 100,0 % |
| Wohnen | 11 | 100,0 % |

**Verwechslungen:**

| erwartet | bekommen | Anzahl |
|---|---|---|
| Gebühren | Sonstiges | 1 |
| Hobbys | Kleidung | 1 |
