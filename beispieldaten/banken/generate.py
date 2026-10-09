"""
Erzeugt Beispiel-Kontoauszüge im Exportformat verschiedener deutscher Banken.

Alle Buchungen, Namen und IBANs sind erfunden. Die Formate sind den CSV-Exporten der Banken
nachgebaut (Spalten, Vorspann, Encoding, Datums- und Betragsformat), Stand 2026.
Die Erwartungswerte in erwartet.json werden hier aus Cent-Beträgen berechnet, nicht mit dem
Parser der App, damit Tests den Parser wirklich prüfen.

Aufruf: python3 beispieldaten/banken/generate.py
"""

import json
from pathlib import Path

OUT = Path(__file__).parent

# (datum, empfänger, zweck, cent, status) – status "booked" oder "pending"
SPARKASSE = [
    ("2026-09-01", "Arbeitgeber Muster GmbH", "LOHN / GEHALT 09/2026", 361240, "booked"),
    ("2026-09-01", "Hausverwaltung Sonnenhof", "Miete 09/2026 Whg 3", -89000, "booked"),
    ("2026-09-02", "Stadtwerke Beispielstadt", "Abschlag Strom Gas Kd-Nr 448812", -11800, "booked"),
    ("2026-09-03", "Familienkasse", "Kindergeld 09/2026 KG-Nr 123FK456789", 25900, "booked"),
    ("2026-09-04", "REWE Markt GmbH", "Kartenzahlung girocard 2026-09-04", -6312, "booked"),
    ("2026-09-05", "Kita Regenbogen e.V.", "Elternbeitrag Verpflegung September", -7450, "booked"),
    ("2026-09-06", "Bäckerei Müller", "Kartenzahlung girocard", -320, "booked"),
    ("2026-09-06", "Bäckerei Müller", "Kartenzahlung girocard", -320, "booked"),
    ("2026-09-08", "Musterversicherung AG", "Haftpflicht Hausrat Beitrag 09/26", -2190, "booked"),
    ("2026-09-10", "Telekom Deutschland GmbH", "Mobilfunk Rechnung 09/2026", -3495, "booked"),
    ("2026-09-12", "Aral Station 4711", "Kartenzahlung Tankstelle", -5820, "booked"),
    ("2026-09-15", "Alex Beispiel", "Sparrate Tagesgeld", -30000, "booked"),
    ("2026-09-18", "Kaufland Größe Straße", "Kartenzahlung girocard", -8467, "booked"),
    ("2026-09-22", "Apotheke am Markt", "Kartenzahlung", -1280, "booked"),
    ("2026-09-26", "Zoo Beispielstadt", "Kartenzahlung Eintritt Familie", -2400, "booked"),
    ("2026-10-01", "Arbeitgeber Muster GmbH", "LOHN / GEHALT 10/2026", 361240, "booked"),
    ("2026-10-01", "Hausverwaltung Sonnenhof", "Miete 10/2026 Whg 3", -89000, "booked"),
    ("2026-10-02", "Stadtwerke Beispielstadt", "Abschlag Strom Gas Kd-Nr 448812", -11800, "booked"),
    ("2026-10-05", "REWE Markt GmbH", "Kartenzahlung girocard 2026-10-05", -7130, "booked"),
    ("2026-10-08", "Bäckerei Müller", "Kartenzahlung girocard", -540, "pending"),
]

ING = [
    ("2026-09-15", "Alex Beispiel", "Sparrate Tagesgeld", 30000, "booked"),
    ("2026-09-16", "Amazon EU S.a.r.l.", "302-1234567-7654321 Amazon.de", -3899, "booked"),
    ("2026-09-19", "PayPal Europe S.a.r.l. et Cie S.C.A", "1040012345678 PP.4471.PP . Thomann GmbH, Ihr Einkauf bei Thomann", -14900, "booked"),
    ("2026-09-21", "Club Hafen", "Gage DJ-Set 19.09.", 25000, "booked"),
    ("2026-09-24", "Spotify AB", "Spotify Premium P1A2B3C4D5", -1099, "booked"),
    ("2026-09-30", "ING", "Zinsen 09/2026", 123, "booked"),
    ("2026-10-02", "Bandcamp Inc", "Kartenzahlung bandcamp.com", -1400, "booked"),
    ("2026-10-04", "Deutsche Bahn Fernverkehr AG", "DB Ticket Auftrag 123456789 Frankfurt-Köln", -4290, "booked"),
    ("2026-10-06", "Anthropic PBC", "Claude Pro Subscription", -2142, "booked"),
]

DKB = [
    ("2026-09-03", "Lidl Dienstleistung GmbH", "Lidl sagt Danke", -3560, "booked"),
    ("2026-09-07", "Netflix International B.V.", "Netflix Monatsabo", -1399, "booked"),
    ("2026-09-11", "Bargeldauszahlung", "GA NR00001234 BLZ12030000 0", -10000, "booked"),
    ("2026-09-14", "Zalando SE", "Bestellung 10293847 Rechnung", -5495, "booked"),
    ("2026-09-17", "dm-drogerie markt", "Kartenzahlung", -1845, "booked"),
    ("2026-09-20", "Finanzamt Beispielstadt", "Erstattung ESt 2025 StNr 123/456/78901", 41200, "booked"),
    ("2026-09-25", "Max Mustermann", "Geld für Konzertkarte", 4500, "booked"),
    ("2026-09-28", "Edeka Center", "Kartenzahlung \"Wocheneinkauf\"", -9214, "booked"),
    ("2026-10-03", "Shell Station", "Kartenzahlung Tankstelle", -6105, "booked"),
    ("2026-10-07", "IKEA Deutschland", "Kartenzahlung Regal Kallax", -12999, "pending"),
]

VOLKSBANK = [
    ("2026-09-01", "Gemeinde Beispielstadt", "Grundsteuer Q3 2026 Az 12-345", -8750, "booked"),
    ("2026-09-04", "ADAC e.V.", "Mitgliedsbeitrag 2026/2027", -9400, "booked"),
    ("2026-09-09", "Musikschule Klangwerk", "Unterricht September Schlagzeug", -6500, "booked"),
    ("2026-09-13", "Fahrradladen Speiche", "Kartenzahlung Reparatur", -4780, "booked"),
    ("2026-09-18", "Hausarztpraxis Dr. Weiß", "Rechnung Nr. 2026-0815 IGeL", -3500, "booked"),
    ("2026-09-23", "Spielwaren Huber", "Kartenzahlung", -1999, "booked"),
    ("2026-09-29", "C&A Mode GmbH", "Kartenzahlung", -5990, "booked"),
    ("2026-10-01", "Verkehrsverbund Rhein-Neckar", "Deutschlandticket 10/2026", -5800, "booked"),
    ("2026-10-06", "Stadtbibliothek", "Jahresgebühr Leseausweis", -1200, "booked"),
]


# Formate, die die App nicht eingebaut hat: Sie muss sie beim ersten Upload selbst erkennen.
N26 = [
    ("2026-09-02", "Edeka Center", "Kartenzahlung", -2245, "booked"),
    ("2026-09-05", "Max Mustermann", "Pizza Freitag", 1500, "booked"),
    ("2026-09-11", "Uber BV", "Uber Fahrt", -1873, "booked"),
    ("2026-09-19", "Steam Games", "Steam Purchase", -1999, "booked"),
    ("2026-10-01", "Alex Beispiel", "Taschengeld Oktober", 20000, "booked"),
    ("2026-10-04", "Lieferando", "Bestellung 7788", -2650, "booked"),
]

DEUTSCHE_BANK = [
    ("2026-09-01", "Versorgungswerk Beispiel", "Rente 09/2026", 142000, "booked"),
    ("2026-09-03", "Vodafone GmbH", "Kabel Internet Kundennr 4711", -3999, "booked"),
    ("2026-09-15", "Allianz Versicherungs-AG", "KFZ-Versicherung VS-Nr 123456", -4850, "booked"),
    ("2026-09-24", "Rossmann", "Kartenzahlung", -1534, "booked"),
    ("2026-10-01", "Versorgungswerk Beispiel", "Rente 10/2026", 142000, "booked"),
    ("2026-10-06", "Tierarztpraxis Pfote", "Rechnung 2026-331 Impfung", -8960, "booked"),
]

COMDIRECT = [
    ("2026-09-01", "Arbeitgeber Beispiel AG", "Gehalt 09/2026", 285000, "booked"),
    ("2026-09-06", "REWE Markt GmbH", "Kartenzahlung", -5612, "booked"),
    ("2026-09-14", "Hansemerkur", "Zahnzusatz Beitrag", -2390, "booked"),
    ("2026-09-27", "Kino Lichtspiele", "Kartenzahlung", -2600, "booked"),
    ("2026-10-01", "Arbeitgeber Beispiel AG", "Gehalt 10/2026", 285000, "booked"),
    ("2026-10-05", "Thalia Bücher", "Kartenzahlung", -3498, "booked"),
]

# Fantasieformat mit Abkürzungen, die keine Heuristik errät: hier muss die KI die Spalten zuordnen.
KONTOFLOW = [
    ("2026-09-08", "Fitnessstudio Kraftwerk", "Monatsbeitrag", -2990, "booked"),
    ("2026-09-21", "Flohmarkt Verkauf", "Verkauf Plattenspieler", 8000, "booked"),
    ("2026-10-02", "Stadtwerke Beispielstadt", "Wasser Abschlag", -3100, "booked"),
]


def de_date(iso, short=False):
    y, m, d = iso.split("-")
    return f"{d}.{m}.{y[2:] if short else y}"


def de_amount(cents, thousands=True):
    sign = "-" if cents < 0 else ""
    euros, rest = divmod(abs(cents), 100)
    e = f"{euros:,}".replace(",", ".") if thousands else str(euros)
    return f"{sign}{e},{rest:02d}"


def q(value):
    return '"' + str(value).replace('"', '""') + '"'


def write(name, text, encoding, bom=False):
    data = text.encode(encoding)
    if bom:
        data = b"\xef\xbb\xbf" + data
    (OUT / name).write_bytes(data)


def sparkasse():
    header = ["Auftragskonto", "Buchungstag", "Valutadatum", "Buchungstext", "Verwendungszweck", "Glaeubiger ID",
              "Mandatsreferenz", "Kundenreferenz (End-to-End)", "Sammlerreferenz", "Lastschrift Ursprungsbetrag",
              "Auslagenersatz Ruecklastschrift", "Beguenstigter/Zahlungspflichtiger", "Kontonummer/IBAN",
              "BIC (SWIFT-Code)", "Betrag", "Waehrung", "Info"]
    lines = [";".join(q(h) for h in header)]
    # Sparkasse lists newest first.
    for date, who, purpose, cents, status in sorted(SPARKASSE, key=lambda t: t[0], reverse=True):
        text = "GUTSCHR. UEBERW. DAUERAUFTR" if cents > 0 else ("KARTENZAHLUNG" if "Karte" in purpose else "FOLGELASTSCHRIFT")
        info = "Umsatz vorgemerkt" if status == "pending" else "Umsatz gebucht"
        row = ["DE00100500000000123456", de_date(date, short=True), de_date(date, short=True), text, purpose,
               "", "", "NOTPROVIDED", "", "", "", who, "DE00100100100000999999", "PBNKDEFFXXX",
               de_amount(cents, thousands=False), "EUR", info]
        lines.append(";".join(q(v) for v in row))
    write("sparkasse.csv", "\r\n".join(lines) + "\r\n", "cp1252")


def ing():
    booked = [t for t in ING if t[4] == "booked"]
    lines = [
        "Umsatzanzeige;Datei erstellt am: 08.10.2026 21:14",
        "",
        "IBAN;DE00 5001 0517 0000 0000 00",
        "Kontoname;Extra-Konto",
        "Bank;ING",
        "Kunde;Alex Beispiel",
        "Zeitraum;01.09.2026 - 08.10.2026",
        "Saldo;5.123,45;EUR",
        "",
        "Sortierung;Datum absteigend",
        "",
        "In der CSV-Datei finden Sie alle bereits gebuchten Umsätze. Die vorgemerkten Umsätze werden nicht aufgenommen, auch wenn sie in Ihrem Internetbanking angezeigt werden.",
        "",
        "Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung",
    ]
    balance = 512345
    for date, who, purpose, cents, _ in sorted(booked, key=lambda t: t[0], reverse=True):
        text = "Gutschrift" if cents > 0 else "Lastschrift"
        lines.append(";".join([de_date(date), de_date(date), who, text, purpose, de_amount(balance), "EUR", de_amount(cents), "EUR"]))
        balance -= cents
    write("ing.csv", "\n".join(lines) + "\n", "latin-1")


def dkb():
    lines = [
        ";".join(q(v) for v in ["Girokonto", "DE00 1203 0000 0000 0000 00"]),
        q(""),
        ";".join(q(v) for v in ["Kontostand vom 08.10.2026:", "2.345,67 €"]),
        q(""),
        ";".join(q(v) for v in ["Buchungsdatum", "Wertstellung", "Status", "Zahlungspflichtige*r", "Zahlungsempfänger*in",
                                "Verwendungszweck", "Umsatztyp", "IBAN", "Betrag (€)", "Gläubiger-ID", "Mandatsreferenz",
                                "Kundenreferenz"]),
    ]
    for date, who, purpose, cents, status in sorted(DKB, key=lambda t: t[0], reverse=True):
        outgoing = cents < 0
        payer, payee = ("Alex Beispiel", who) if outgoing else (who, "Alex Beispiel")
        row = [de_date(date, short=True), de_date(date, short=True), "Vorgemerkt" if status == "pending" else "Gebucht",
               payer, payee, purpose, "Ausgang" if outgoing else "Eingang", "DE00500105170000000001",
               de_amount(cents), "", "", ""]
        lines.append(";".join(q(v) for v in row))
    write("dkb.csv", "\n".join(lines) + "\n", "utf-8", bom=True)


def volksbank():
    header = ["Bezeichnung Auftragskonto", "IBAN Auftragskonto", "BIC Auftragskonto", "Bankname Auftragskonto",
              "Buchungstag", "Valutadatum", "Name Zahlungsbeteiligter", "IBAN Zahlungsbeteiligter",
              "BIC (SWIFT-Code) Zahlungsbeteiligter", "Buchungstext", "Verwendungszweck", "Betrag", "Waehrung",
              "Saldo nach Buchung", "Bemerkung", "Kategorie", "Steuerrelevant", "Glaeubiger ID", "Mandatsreferenz"]
    lines = [";".join(header)]
    balance = 98765
    for date, who, purpose, cents, _ in sorted(VOLKSBANK, key=lambda t: t[0]):
        balance += cents
        text = "Kartenzahlung" if "Karte" in purpose else "Basislastschrift"
        row = ["Gemeinschaftskonto", "DE00600901000000000000", "GENODES1VBH", "Volksbank Beispielstadt eG",
               de_date(date), de_date(date), who, "DE00700202700000000002", "HYVEDEMMXXX", text, purpose,
               de_amount(cents), "EUR", de_amount(balance), "", "", "", "", ""]
        lines.append(";".join(row))
    write("volksbank.csv", "\r\n".join(lines) + "\r\n", "utf-8", bom=True)


def n26():
    header = ["Booking Date", "Value Date", "Partner Name", "Partner Iban", "Type", "Payment Reference",
              "Account Name", "Amount (EUR)", "Original Amount", "Original Currency", "Exchange Rate"]
    lines = [",".join(q(h) for h in header)]
    for date, who, purpose, cents, _ in sorted(N26, key=lambda t: t[0], reverse=True):
        kind = "Income" if cents > 0 else "Presentment"
        amount = f"{cents / 100:.2f}"
        lines.append(",".join(q(v) for v in [date, date, who, "", kind, purpose, "Hauptkonto", amount, "", "", ""]))
    write("neu/n26-csv-transactions.csv", "\n".join(lines) + "\n", "utf-8")


def deutsche_bank():
    lines = [
        "Umsätze Girokonto;Zeitraum: 01.09.2026 - 08.10.2026;",
        "Kontonummer;DE00 1007 0000 0000 0000 03;",
        "",
        "Buchungstag;Wert;Umsatzart;Begünstigter / Auftraggeber;Verwendungszweck;IBAN;BIC;Kundenreferenz;"
        "Mandatsreferenz ;Gläubiger ID;Fremde Gebühren;Abweichender Empfänger;Anzahl der Aufträge;"
        "Anzahl der Schecks;Soll;Haben;Währung",
    ]
    for date, who, purpose, cents, _ in sorted(DEUTSCHE_BANK, key=lambda t: t[0], reverse=True):
        kind = "SEPA-Gutschrift" if cents > 0 else "SEPA-Lastschrift"
        soll = de_amount(cents) if cents < 0 else ""
        haben = de_amount(cents) if cents > 0 else ""
        lines.append(";".join([de_date(date), de_date(date), kind, who, purpose, "DE00500105170000000004",
                               "INGDDEFFXXX", "", "", "", "", "", "", "", soll, haben, "EUR"]))
    lines += ["Kontostand;08.10.2026;;;3.456,78;EUR"]
    write("neu/Kontoumsaetze_100_1234567_00_20261008.csv", "\r\n".join(lines) + "\r\n", "cp1252")


def comdirect():
    lines = [
        ";",
        q("Umsätze Girokonto") + ";" + q("Zeitraum: 01.09.2026 - 08.10.2026") + ";",
        q("Neuer Kontostand") + ";" + q("4.321,00 EUR") + ";",
        "",
        ";".join(q(h) for h in ["Buchungstag", "Wertstellung (Valuta)", "Vorgang", "Buchungstext", "Umsatz in EUR"]) + ";",
    ]
    for date, who, purpose, cents, _ in sorted(COMDIRECT, key=lambda t: t[0], reverse=True):
        if cents > 0:
            vorgang, text = "Übertrag / Überweisung", f"Auftraggeber: {who} Buchungstext: {purpose} Ref. 7Z2C21SJ3G1V8J1M/1"
        else:
            vorgang = "Visa-Umsatz" if "Karte" in purpose else "Lastschrift / Belastung"
            text = f"Empfänger: {who} Kto/IBAN: DE00200411110000000005 BLZ/BIC: COBADEHD001 Buchungstext: {purpose} Ref. 3K1Q9P/2"
        lines.append(";".join(q(v) for v in [de_date(date), de_date(date), vorgang, text, de_amount(cents)]) + ";")
    lines += ["", q("Alter Kontostand") + ";" + q("1.234,56 EUR") + ";"]
    write("neu/umsaetze_1234567890_20261008-2114.csv", "\n".join(lines) + "\n", "cp1252")


def kontoflow():
    lines = ["Txn Dt;Ccy;Amt;Ctpy;Memo;Bal"]
    balance = 50000
    for date, who, purpose, cents, _ in sorted(KONTOFLOW, key=lambda t: t[0]):
        balance += cents
        lines.append(";".join([date, "EUR", f"{cents / 100:.2f}", who, purpose, f"{balance / 100:.2f}"]))
    write("neu/kontoflow-export.csv", "\n".join(lines) + "\n", "utf-8")


def expected():
    def summary(rows, pending_counts_as_row=True):
        booked = [r for r in rows if r[4] == "booked"]
        months = {}
        for date, _, _, cents, _ in booked:
            m = months.setdefault(date[:7], {"rows": 0, "income_cents": 0, "expense_cents": 0})
            m["rows"] += 1
            m["income_cents" if cents > 0 else "expense_cents"] += cents
        return {
            "rows_total": len(rows) if pending_counts_as_row else len(booked),
            "booked": len(booked),
            "pending": len(rows) - len(booked),
            "sum_cents": sum(r[3] for r in booked),
            "months": months,
        }

    data = {
        "_hinweis": "Von generate.py aus Cent-Werten berechnet, nicht mit dem App-Parser. Vorgemerkte Umsätze sind in rows_total enthalten (sie stehen in der Datei), aber nicht in sum_cents.",
        "sparkasse.csv": {"profile": "sparkasse", **summary(SPARKASSE)},
        # ING exportiert vorgemerkte Umsätze gar nicht erst.
        "ing.csv": {"profile": "ing", **summary(ING, pending_counts_as_row=False)},
        "dkb.csv": {"profile": "dkb", **summary(DKB)},
        "volksbank.csv": {"profile": "volksbank", **summary(VOLKSBANK)},
        # Unbekannte Formate: rows_total zählt nur Buchungszeilen, Fußzeilen mit Kontostand kommen als „übersprungen“ dazu.
        "neu/n26-csv-transactions.csv": {"profile": "auto", "learned": "heuristic", "own_iban": False, "footer_lines": 0, **summary(N26)},
        "neu/Kontoumsaetze_100_1234567_00_20261008.csv": {"profile": "auto", "learned": "heuristic", "own_iban": True, "footer_lines": 1, **summary(DEUTSCHE_BANK)},
        "neu/umsaetze_1234567890_20261008-2114.csv": {"profile": "auto", "learned": "heuristic", "own_iban": False, "footer_lines": 1, **summary(COMDIRECT)},
        "neu/kontoflow-export.csv": {"profile": "auto", "learned": "ai", "own_iban": False, "footer_lines": 0, **summary(KONTOFLOW)},
    }
    (OUT / "erwartet.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sparkasse()
    ing()
    dkb()
    volksbank()
    (OUT / "neu").mkdir(exist_ok=True)
    n26()
    deutsche_bank()
    comdirect()
    kontoflow()
    expected()
    print("geschrieben:", ", ".join(sorted(str(p.relative_to(OUT)) for p in OUT.rglob("*.csv"))))
