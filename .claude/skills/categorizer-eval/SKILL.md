---
name: categorizer-eval
description: Use before and after changing the LLM categorization prompt, the model, the confidence threshold or the category list, to measure whether accuracy improved or regressed.
---

# Kategorisierung ändern und messen

Das Eval-Set `evals/kategorisierung.json` enthält gut 200 erfundene, von Hand beschriftete Buchungen. `pnpm eval` misst den echten Ablauf: erst die eingebaute Händlerliste (kostenlos), dann das Modell für den Rest, und meldet beide Trefferquoten getrennt. Fehler der Händlerliste fängt schon `pnpm test` (`evals/known-merchants.eval.test.ts`), ohne Modell und ohne Kosten. Neue Fälle immer erfinden und von Hand beschriften, nie mit dem Modell erzeugen.

1. Vor der Änderung: `pnpm eval` ausführen und Ergebnis notieren (Trefferquote, Anteil „prüfen“, falsch mit hoher Konfidenz).
2. Änderung in `app/lib/categorize/llm.ts` bzw. Kategorienliste vornehmen.
3. `PROMPT_VERSION` in `app/lib/categorize/llm.ts` erhöhen und den Fingerabdruck in `llm.test.ts` nachtragen (der Test nennt ihn). Jede KI-Entscheidung speichert Version und Modell.
4. Nach der Änderung: `pnpm eval` erneut ausführen.
5. Vergleich als Tabelle ausgeben:

   | Kennzahl | vorher | nachher |
   |---|---|---|
   | Trefferquote | | |
   | Anteil needs_review | | |
   | Falsch mit Konfidenz ≥ 0,7 | | |

6. Ergebnis bewerten:
   - „Falsch mit Konfidenz ≥ 0,7“ ist die wichtigste Zahl. Diese Fehler sieht der Nutzer nicht. Sie darf nicht steigen.
   - Trefferquote darf nicht sinken, außer der Nutzer stimmt ausdrücklich zu.
7. Fehlschläge einzeln auflisten (Buchung, erwartet, bekommen, Konfidenz) und begründen.
8. Wenn ein neuer Fehlertyp auftaucht, passende Fälle zum Eval-Set hinzufügen.
9. Commit mit Änderung und Eval-Ergebnis in der Commit-Message.

## Regeln für den Prompt

- Kategorien werden per Name übergeben. Jede Antwort wird einzeln gegen die Liste geprüft: Ein unbekannter Name schickt nur diese Buchung nach „prüfen“, nicht den ganzen Batch.
- Kein Raten bei Umbuchungen zwischen eigenen Konten: `Umbuchung` nur, wenn der Text das klar zeigt.
- Bei Unklarheit niedrige Konfidenz statt einer plausiblen, aber unsicheren Kategorie.
