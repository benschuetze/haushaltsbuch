---
name: categorizer-eval
description: Use before and after changing the LLM categorization prompt, the model, the confidence threshold or the category list, to measure whether accuracy improved or regressed.
---

# Kategorisierung ändern und messen

Das Eval-Set `evals/kategorisierung.json` enthält erfundene Buchungen mit erwarteter Kategorie.

1. Vor der Änderung: `pnpm eval` ausführen und Ergebnis notieren (Trefferquote, Anteil „prüfen“, falsch mit hoher Konfidenz).
2. Änderung in `app/lib/categorize/llm.ts` bzw. Kategorienliste vornehmen.
3. Nach der Änderung: `pnpm eval` erneut ausführen.
4. Vergleich als Tabelle ausgeben:

   | Kennzahl | vorher | nachher |
   |---|---|---|
   | Trefferquote | | |
   | Anteil needs_review | | |
   | Falsch mit Konfidenz ≥ 0,7 | | |

5. Ergebnis bewerten:
   - „Falsch mit Konfidenz ≥ 0,7“ ist die wichtigste Zahl. Diese Fehler sieht der Nutzer nicht. Sie darf nicht steigen.
   - Trefferquote darf nicht sinken, außer der Nutzer stimmt ausdrücklich zu.
6. Fehlschläge einzeln auflisten (Buchung, erwartet, bekommen, Konfidenz) und begründen.
7. Wenn ein neuer Fehlertyp auftaucht, passende Fälle zum Eval-Set hinzufügen.
8. Commit mit Änderung und Eval-Ergebnis in der Commit-Message.

## Regeln für den Prompt

- Kategorien werden mit ID und Name übergeben, das Schema erlaubt nur diese IDs.
- Kein Raten bei Umbuchungen zwischen eigenen Konten: `Umbuchung` nur, wenn der Text das klar zeigt.
- Bei Unklarheit niedrige Konfidenz statt einer plausiblen, aber unsicheren Kategorie.
