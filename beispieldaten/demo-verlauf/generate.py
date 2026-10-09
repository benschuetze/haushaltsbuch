"""
Erzeugt den Verlauf für die öffentliche Demo: Girokonto April bis Juli und Anfang Oktober 2026
(August/September stehen in ../demo-umsaetze.csv) plus einen PayPal-Export Juni bis Oktober.

Alles ist erfunden. Der Verlauf ist so gebaut, dass die Demo zeigt, was die App kann:
- Spotify wird im Oktober teurer (Preiserhöhung)
- Netflix über PayPal und Disney+ per Lastschrift (zwei Video-Streamingdienste)
- ein vergessenes Fitnessstudio-Abo
- PayPal-Einkäufe, deren Abbuchung auf dem Girokonto nicht doppelt zählt
- im Oktober viel Lieferdienst (Budget wird knapp)

Aufruf: python3 beispieldaten/demo-verlauf/generate.py
"""

import csv
import io
import random
from pathlib import Path

OUT = Path(__file__).parent
rnd = random.Random(2026)


def euro(cents):
    s = f"{abs(cents) / 100:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"-{s}" if cents < 0 else s


def d(y, m, day):
    return f"{day:02d}.{m:02d}.{y}"


giro = []
paypal = []
code = [1000]


def pp(date, name, item, cents, typ="Allgemeine Zahlung"):
    """A PayPal purchase paid from the bank: payment, top-up and the bank's PayPal debit a day later."""
    code[0] += 2
    pay, top = f"7D{code[0]:015d}", f"7D{code[0] + 1:015d}"
    paypal.append([date, name, typ, "EUR", euro(-cents), pay, "", item, "Soll"])
    paypal.append([date, "", "Allgemeine Abbuchung – Bankkonto", "EUR", euro(cents), top, pay, "", "Haben"])
    dd, mm, yy = (int(x) for x in date.split("."))
    giro.append((d(yy, mm, min(dd + 1, 28)), "PayPal Europe", f"{pay} PP.4471.PP . {name}, Ihr Einkauf bei {name}", -cents))


MONTHS = [(2026, 4), (2026, 5), (2026, 6), (2026, 7)]
for y, m in MONTHS:
    giro += [
        (d(y, m, 1), "Arbeitgeber Muster GmbH", f"Gehalt {m:02d}/{y}", 361240),
        (d(y, m, 1), "Hausverwaltung Sonnenhof", f"Miete {m:02d}/{y} Whg 3", -89000),
        (d(y, m, 2), "Stadtwerke Beispielstadt", "Abschlag Strom Gas Kd-Nr 448812", -11800),
        (d(y, m, 2), "FitX Deutschland GmbH", "Mitgliedsbeitrag Studio Beispielstadt", -2499),
        (d(y, m, 3), "Familienkasse", "Kindergeld", 25900),
        (d(y, m, 3), "Disney Plus", "Disney+ Monatsabo", -999),
        (d(y, m, 5), "Kita Regenbogen e.V.", "Elternbeitrag Verpflegung", -7450),
        (d(y, m, 5), "Musterversicherung AG", "Haftpflicht Hausrat Beitrag", -2190),
        (d(y, m, 7), "Spotify AB", "Spotify Premium", -1099),
        (d(y, m, 8), "Anthropic PBC", "Claude Pro Subscription", -2142),
        (d(y, m, 10), "Telekom Deutschland", "Mobilfunk Rechnung", -3495),
        (d(y, m, 15), "Eigenes Tagesgeld", "Sparrate", -30000),
    ]
    for day in (4, 11, 18, 25):
        shop = rnd.choice(["REWE Markt", "ALDI SUED", "Lidl"])
        giro.append((d(y, m, day), shop, "Kartenzahlung girocard", -rnd.randrange(3500, 9500, 5)))
    giro.append((d(y, m, rnd.randint(9, 14)), "Aral Station", "Kartenzahlung Tankstelle", -rnd.randrange(4800, 7200, 10)))
    giro.append((d(y, m, rnd.randint(12, 20)), "dm-drogerie markt", "Kartenzahlung girocard", -rnd.randrange(900, 3200, 5)))
    giro.append((d(y, m, rnd.randint(20, 27)), "Baeckerei Kern", "Kartenzahlung girocard", -rnd.randrange(400, 1200, 10)))
    if m >= 6:
        pp(d(y, m, 12), "Netflix International B.V.", "Netflix Standard", 1399,
           "Zahlung im Einzugsverfahren mit Zahlungsrechnung")
        pp(d(y, m, rnd.randint(16, 24)), "Zalando SE", "Bestellung", rnd.randrange(2990, 8990, 10))
    if m == 7:
        giro.append((d(y, m, 19), "Deutsche Bahn", "DB Fernverkehr Ticket Urlaub", -18900))
        pp(d(y, m, 6), "Lieferando.de", "Bestellung", 3150)

# August and September live in demo-umsaetze.csv; PayPal keeps Netflix running through them.
for m in (8, 9):
    pp(d(2026, m, 12), "Netflix International B.V.", "Netflix Standard", 1399,
       "Zahlung im Einzugsverfahren mit Zahlungsrechnung")

# Early October: the month the demo is about.
y, m = 2026, 10
giro += [
    (d(y, m, 1), "Arbeitgeber Muster GmbH", f"Gehalt {m:02d}/{y}", 361240),
    (d(y, m, 1), "Hausverwaltung Sonnenhof", f"Miete {m:02d}/{y} Whg 3", -89000),
    (d(y, m, 2), "Stadtwerke Beispielstadt", "Abschlag Strom Gas Kd-Nr 448812", -11800),
    (d(y, m, 2), "FitX Deutschland GmbH", "Mitgliedsbeitrag Studio Beispielstadt", -2499),
    (d(y, m, 3), "Familienkasse", "Kindergeld", 25900),
    (d(y, m, 3), "Disney Plus", "Disney+ Monatsabo", -999),
    (d(y, m, 5), "Kita Regenbogen e.V.", "Elternbeitrag Verpflegung", -7450),
    (d(y, m, 5), "Musterversicherung AG", "Haftpflicht Hausrat Beitrag", -2190),
    (d(y, m, 4), "REWE Markt", "Kartenzahlung girocard", -6840),
    (d(y, m, 7), "Spotify AB", "Spotify Premium", -1199),
    (d(y, m, 8), "Anthropic PBC", "Claude Pro Subscription", -2142),
]
for day, cents in ((2, 2890), (4, 3420), (6, 2650), (8, 3980)):
    pp(d(y, m, day), "Lieferando.de", "Bestellung", cents)

giro.sort(key=lambda r: (r[0][6:], r[0][3:5], r[0][:2]))
with open(OUT / "girokonto.csv", "w", encoding="utf-8", newline="") as f:
    f.write("Buchungstag;Wertstellung;Empfänger/Auftraggeber;Verwendungszweck;Betrag;Währung\r\n")
    for date, name, purpose, cents in giro:
        f.write(f"{date};{date};{name};{purpose};{euro(cents)};EUR\r\n")

H = ["Datum", "Uhrzeit", "Zeitzone", "Name", "Typ", "Status", "Währung", "Brutto", "Gebühr", "Netto",
     "Transaktionscode", "Zugehöriger Transaktionscode", "Artikelbezeichnung", "Guthaben", "Auswirkung auf Guthaben"]
buf = io.StringIO()
w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
w.writerow(H)
for date, name, typ, cur, amount, tx, related, item, impact in paypal:
    w.writerow([date, "12:00:00", "CET", name, typ, "Abgeschlossen", cur, amount, "0,00", amount, tx, related, item,
                "0,00", impact])
(OUT / "paypal.csv").write_text(buf.getvalue(), encoding="utf-8-sig")
print(f"girokonto.csv: {len(giro)} Buchungen, paypal.csv: {len(paypal)} Zeilen")
