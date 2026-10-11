---
name: e-ink-design
description: Use when building or changing any UI in the Haushaltsbuch, so new screens follow the e-ink ledger look (paper, ink, pen blue, double-underlined sum, pixel labels).
---

# E-Ink-Design im Haushaltsbuch

Quelle aller Werte: `app/app.css`. Dort nichts doppeln, nur Tokens benutzen.

## Regeln

- Farben über shadcn-Tokens (`bg-card`, `text-muted-foreground`, `border-foreground`) oder die umgefärbten Paletten: `emerald-*` ist Tinte, `amber-*` ist Stiftblau auf blassblauem Papier, `red-*`/`rose-*` tiefes Rot. Kein Gelb, kein Neon.
- Neue Paletten-Stufe benutzt? In `app/app.css` im `@theme` umfärben, sonst schlägt `tests/design-palette.test.ts` fehl.
- Pro Ansicht genau eine Hauptzahl mit `.summe` (Stiftblau, doppelt unterstrichen).
- Labels über Zahlen und Abschnitten: `.pixel`. Beträge immer über `<Amount>` oder `font-mono tabular-nums`.
- Objekte: `rounded border-2 border-foreground bg-card`. Keine Schatten (global abgeschaltet), keine großen Radien.
- Balken eckig: Spur `h-3 border-2 border-foreground`, Füllung `h-full` (siehe `category-bars.tsx`).
- Aufschlüsselungen als Kassenbuchzeilen: Label, `<span className="leader" />`, Betrag (siehe `Line` in `ask-today.tsx`).
- Mocks sichtbar kennzeichnen: Hinweis in `bg-amber-50 text-amber-950` mit `.pixel`-Label „Mockdaten“.
- Mobile: Tab-Leiste (`tab-bar.tsx`) bleibt bei fünf Zielen; neue Seiten unter „Mehr“ in `MORE` eintragen. Fixierte Elemente dürfen keine Buttons verdecken (E2E auf iPhone 13 prüft das).
- Überschriften h1/h2 sind automatisch EB Garamond.

## Prüfen

Skill `verify`: `pnpm check`, dann die Seite hell und dunkel auf 375px ansehen. Doppellinie der `.summe` darf nichts überlappen.

Für andere Projekte gibt es denselben Look als globalen Skill `e-ink-design` (`~/.claude/skills/e-ink-design`, mit `tokens.css`).
