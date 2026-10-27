import Foundation

// Core tests, run on the Mac with the plain Swift toolchain (no Xcode needed): ios/scripts/test-core.sh.
// Expected values come from the TypeScript tests and beispieldaten/erwartet.json, never from the Swift code itself.

// Unbuffered so a crash later never swallows the failures printed before it.
setvbuf(stdout, nil, _IONBF, 0)

var failures = 0
var checks = 0

func check(_ ok: Bool, _ message: String, file: String = #file, line: Int = #line) {
    checks += 1
    if !ok {
        failures += 1
        print("FAIL \(message) (\(URL(fileURLWithPath: file).lastPathComponent):\(line))")
    }
}

func equal<T: Equatable>(_ actual: T, _ expected: T, _ message: String, line: Int = #line) {
    check(actual == expected, "\(message): expected \(expected), got \(actual)", line: line)
}

let root = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
func sample(_ path: String) -> Data {
    guard let data = FileManager.default.contents(atPath: "\(root)/beispieldaten/\(path)") else {
        fatalError("sample missing: \(path)")
    }
    return data
}

// MARK: Money

equal(try! Money.parseGermanAmount("-1.234,56"), -123456, "german amount with thousands")
equal(try! Money.parseGermanAmount("1.234,56"), 123456, "german amount")
equal(try! Money.parseGermanAmount("3.612,40"), 361240, "german amount salary")
equal(try! Money.parseGermanAmount("7,5 €"), 750, "one fraction digit")
equal(try! Money.parseEnglishAmount("-26.50"), -2650, "english amount")
equal(try! Money.parseEnglishAmount("1,234.5"), 123450, "english thousands")
check((try? Money.parseGermanAmount("abc")) == nil, "abc is rejected")
equal(try! Money.parseGermanDate("08.10.26"), "2026-10-08", "two-digit year")
equal(try! Money.parseDate("2026-10-04"), "2026-10-04", "iso date")
equal(try! Money.parseDate("4/10/2026"), "2026-10-04", "slash date")
check((try? Money.parseGermanDate("31.02.2026")) == nil, "impossible date is rejected")
equal(Money.format(-123456), "−1.234,56 €", "format negative")
equal(Money.format(99), "0,99 €", "format cents")
equal(Money.format(6958), "69,58 €", "format")
equal(Money.detectDecimalStyle(["-26.50", "200.00"]), .en, "detect en")
equal(Money.detectDecimalStyle(["1.234"]), nil, "ambiguous")

// MARK: Days

equal(Day.addMonths("2027-01-31", 1), "2027-02-28", "clamped month end")
equal(Day.addMonths("2026-12-15", 1), "2027-01-15", "year roll")
equal(Day.daysBetween("2026-10-09", "2026-11-01"), 23, "days between")
equal(Day.bankDay("2026-11-01"), "2026-11-02", "sunday → monday")
equal(Day.bankDay("2026-10-03"), "2026-10-05", "holiday 3.10. (Saturday) → monday")
equal(Day.bankDay("2026-04-03"), "2026-04-07", "Karfreitag 2026 → Tuesday after Ostermontag")
equal(Day.weekday("2026-11-01"), 1, "1.11.2026 is a Sunday")

// MARK: Spoken amounts (cases from amount.test.ts)

let certain: [(String, Int)] = [
    ("7€", 700), ("7 €", 700), ("7 Euro", 700), ("7 EUR", 700), ("EUR 7,50", 750), ("€7", 700), ("7,50 Euro", 750),
    ("7,50€", 750), ("7.50€", 750), ("7.5 Euro", 750), ("12,5 Euro", 1250), ("0,99 €", 99), ("7,- Euro", 700),
    ("1.234,56 Euro", 123456), ("1.234 Euro", 123400), ("100 Euro", 10000), ("1 Euro", 100), ("7 Euro 50", 750),
    ("7 Euro und 50 Cent", 750), ("7 euro 50 cent", 750), ("3 Euro 5 Cent", 305), ("3 Euro 2 Döner", 300),
    ("50 Cent", 50), ("50 ct", 50), ("5 Cent", 5), ("hab grad 7€ für nen döner gezahlt", 700),
    ("Hab gerade 7 Euro für Döner bezahlt", 700), ("habe 2 Döner für 14 Euro gekauft", 1400), ("Döner 7 Euro", 700),
    ("7 Euro Döner", 700), ("Tanken 54,32 Euro", 5432), ("bar 7 Euro Döner", 700), ("Döner sieben Euro", 700),
    ("einen Döner für 7 Euro", 700), ("hab 7 Euro für Döner gezahlt und eine Tüte", 700), ("hab 7 für Döner gezahlt", 700),
    ("Kaffee 3,80", 380), ("9,99", 999), ("am 12.10. Döner 7 Euro", 700),
    ("sieben Euro achtzig für Brötchen und eine Zeitung", 780), ("fünf Euro und eine Zeitung", 500),
    ("sieben Euro", 700), ("zwei Euro", 200), ("elf Euro", 1100), ("zwölf Euro", 1200), ("sechzehn Euro", 1600),
    ("siebzehn Euro", 1700), ("sechzig Euro", 6000), ("siebzig Euro", 7000), ("dreißig Euro", 3000),
    ("dreissig Euro", 3000), ("fuenf Euro", 500), ("fünf Euro", 500), ("einundzwanzig Euro", 2100),
    ("fünfunddreißig Euro", 3500), ("hundert Euro", 10000), ("einhundert Euro", 10000), ("hundertfünfzig Euro", 15000),
    ("zweihundertdreiundvierzig Euro", 24300), ("tausend Euro", 100000), ("zweitausend Euro", 200000),
    ("ein Euro", 100), ("ein Euro fünfzig", 150), ("ein Euro zwanzig", 120), ("sieben Euro fünfzig", 750),
    ("sieben euro und fünfzig cent", 750), ("fünf Euro zwanzig", 520), ("fünf Euro und zwanzig Cent", 520),
    ("fünf Euro zehn", 510), ("fünf Euro neunundneunzig", 599), ("neun Euro neunzig", 990), ("drei Euro dreißig", 330),
    ("sieben Euro und siebenundfünfzig Cent", 757), ("null Euro fünfzig", 50), ("fünfzig Cent", 50),
    ("zwanzig cent", 20), ("sieben Euro 50", 750), ("7 Euro fünfzig", 750), ("zwei Döner für vierzehn Euro", 1400),
    ("sieben fünfzig", 750), ("zwölf neunzig", 1290), ("ein Döner für sieben fünfzig", 750),
    ("sieben komma fünf Euro", 750), ("sieben komma fünfzig Euro", 750), ("drei komma neunundneunzig", 399),
    ("einen Euro fünfzig", 150), ("hab einen Euro fünfzig für nen Kaffee bezahlt", 150), ("nen Euro fünfzig", 150),
    ("einen Euro und fünfzig Cent", 150), ("eine Cola für einen Euro", 100), ("sieben fünfzig Euro", 750),
    ("7 50 Euro", 750), ("Euro sieben fünfzig", 750), ("EUR 7 50", 750), ("zweieinhalb Euro", 250),
    ("dreieinhalb Euro für Brot", 350), ("anderthalb Euro", 150),
]
for (text, cents) in certain {
    equal(SpokenAmountParser.parse(text), SpokenAmount(cents: cents, certain: true), "certain \"\(text)\"")
}
let flagged: [(String, Int)] = [
    ("7 Euro für Döner und 3 Euro für Cola", 1000), ("hab zwei Döner gekauft", 200), ("achtzehn", 1800),
    ("2000000 Euro", 200000000), ("Döner 6,50 plus 1 Euro Trinkgeld", 100), ("Döner 7 Euro und Cola 2,50", 700),
    ("Döner 7,50, mit 10 Euro bezahlt", 1000), ("Döner sieben fünfzig und Cola zwei fünfzig", 250),
    ("Döner 7,50 und Cola zwei fünfzig", 750),
]
for (text, cents) in flagged {
    equal(SpokenAmountParser.parse(text), SpokenAmount(cents: cents, certain: false), "flagged \"\(text)\"")
}
for text in ["", "   ", "Döner", "ein Döner", "hab einen Döner gekauft", "0 Euro", "null", "Euro", "€", "komma"] {
    check(SpokenAmountParser.parse(text) == nil, "no amount in \"\(text)\"")
}
for euros in stride(from: 0, through: 999, by: 37) {
    for cents in 0...99 where euros + cents > 0 {
        let text = "\(euros),\(String(format: "%02d", cents)) Euro"
        equal(SpokenAmountParser.parse(text), SpokenAmount(cents: euros * 100 + cents, certain: true), "round trip \(text)")
    }
}
// Never crashes, only positive integer cents, whatever the input.
var seed: UInt64 = 42
func next() -> Int { seed = (seed &* 1664525 &+ 1013904223) % 4294967296; return Int(seed) }
let alphabet = Array("0123456789,.-€ abcdefzüöß\n\t")
let words = ["euro", "cent", "und", "komma", "hundert", "tausend", "ein", "fünf", "zig", "\u{0}"]
for _ in 0..<3000 {
    var text = ""
    for _ in 0..<(1 + next() % 12) {
        text += next() % 3 == 0 ? " \(words[next() % words.count]) " : String(alphabet[next() % alphabet.count])
    }
    if let r = SpokenAmountParser.parse(text) { check(r.cents > 0, "positive cents for \(text.debugDescription)") }
}

// MARK: Counterparty from a sentence (cases from run.test.ts)

for (text, payee) in [
    ("hab grad 7€ für nen döner gezahlt", "Döner"), ("hab grad 7 Euro für nen Döner gezahlt", "Döner"),
    ("gerade beim Bäcker 3,20 ausgegeben", "Bäcker"), ("hab mir eben nen Kaffee für 3,50 gekauft", "Kaffee"),
    ("zwanzig Euro beim Friseur bezahlt", "Friseur"), ("12 Euro im Kino", "Kino"),
    ("Bäckerei am Markt 4 Euro", "Bäckerei am Markt"), ("7,50€ Pizza", "Pizza"), ("€7 Pizza", "Pizza"),
    ("gestern 5 Euro zum Bäcker", "Bäcker"), ("Kaffee bei Anna 3 Euro", "Kaffee bei Anna"),
    ("hab grad 7€ gezahlt", "Hab grad gezahlt"), ("7 Euro", "7 Euro"),
] {
    equal(Capture.counterparty(from: text), payee, "counterparty of \"\(text)\"")
}
let noon = Day.date("2026-10-21").addingTimeInterval(12 * 3600)
equal(Capture.bookingDate("gestern 5 Euro Bäcker", now: noon), "2026-10-20", "gestern")
equal(Capture.bookingDate("vorgestern 5 Euro Bäcker", now: noon), "2026-10-19", "vorgestern")
// 23:30 UTC on the 20th is already the 21st in Berlin.
equal(Capture.bookingDate("5 Euro", now: Day.date("2026-10-20").addingTimeInterval(23.5 * 3600)), "2026-10-21", "berlin day")

// MARK: Budget (HOUSEHOLD from available.test.ts, hand-checked numbers for 9 October 2026)

func b(_ date: String, _ counterparty: String, _ cents: Int, _ kind: CategoryKind = .expense, _ name: String? = nil) -> Booking {
    Booking(bookingDate: date, amountCents: cents, counterparty: counterparty, purpose: "", categoryName: name, categoryKind: kind)
}
var household: [Booking] = []
for m in ["08", "09", "10"] {
    household += [
        b("2026-\(m)-01", "Arbeitgeber Muster GmbH", 300000, .income, "Einkommen"),
        b("2026-\(m)-01", "Hausverwaltung Sonnenhof", -90000, .expense, "Wohnen"),
        b("2026-\(m)-07", "Spotify AB", -1099, .expense, "Abos & Verträge"),
    ]
    if m != "10" {
        household += [
            b("2026-\(m)-12", "Netflix", -1399, .expense, "Abos & Verträge"),
            b("2026-\(m)-15", "Eigenes Tagesgeld", -30000, .transfer, "Umbuchung"),
            b("2026-\(m)-20", "REWE Markt", -8000, .expense, "Lebensmittel"),
        ]
    }
}
household += [b("2026-10-03", "REWE Markt", -6000, .expense, "Lebensmittel"), b("2026-10-08", "Lidl", -4500, .expense, "Lebensmittel")]

let a = Budget.available(household, today: "2026-10-09")
equal(a.nextIncome, Due(name: "Arbeitgeber Muster GmbH", date: "2026-11-02", amountCents: 300000), "next income")
equal(a.periodStart, "2026-10-01", "period start")
equal(a.periodEnd, "2026-11-01", "period end")
equal(a.daysLeft, 24, "days left")
equal(a.incomeCents, 300000, "income")
equal(a.spentCents, 101599, "spent")
equal(a.upcoming, [Due(name: "Netflix", date: "2026-10-12", amountCents: 1399), Due(name: "Eigenes Tagesgeld", date: "2026-10-15", amountCents: 30000)], "upcoming")
equal(a.freeCents, 167002, "free")
equal(a.perDayCents, 6958, "per day")
check(a.missingIncome == nil, "no missing income")

let before = Budget.available(household, today: "2026-10-16")
let booked = Budget.available(household + [b("2026-10-15", "Eigenes Tagesgeld", -30000, .transfer, "Umbuchung")], today: "2026-10-16")
equal(booked.freeCents, before.freeCents, "savings transfer does not bump the budget once booked")
check(!booked.upcoming.contains { $0.name == "Eigenes Tagesgeld" }, "booked transfer no longer upcoming")

let extra = household + [
    b("2026-08-11", "Aral Station", -5820, .expense, "Mobilität"), b("2026-09-11", "Aral Station", -6390, .expense, "Mobilität"),
    b("2026-08-13", "PayPal Europe", -1399, .transfer, "Umbuchung"), b("2026-09-13", "PayPal Europe", -1399, .transfer, "Umbuchung"),
]
equal(Budget.available(extra, today: "2026-10-09").upcoming.map(\.name), ["Netflix", "Eigenes Tagesgeld"], "fuel and PayPal not predicted")

let noSalary = Budget.available(household.filter { $0.categoryKind != .income }, today: "2026-10-09")
check(noSalary.nextIncome == nil, "no salary → no next income")
equal(noSalary.periodStart, "2026-10-01", "calendar month start")
equal(noSalary.periodEnd, "2026-10-31", "calendar month end")
equal(noSalary.perDayCents, 0, "overdrawn → 0 per day")

equal(Budget.available(household, today: "2026-11-03").nextIncome?.date, "2026-11-02", "late salary keeps payday")

let withoutOctober = household.filter { !($0.categoryKind == .income && $0.bookingDate == "2026-10-01") }
let gap = Budget.available(withoutOctober, today: "2026-10-09")
equal(gap.periodStart, "2026-10-01", "gap period start")
equal(gap.periodEnd, "2026-11-01", "gap period end")
equal(gap.missingIncome, Due(name: "Arbeitgeber Muster GmbH", date: "2026-10-01", amountCents: 300000), "missing income reported")
equal(gap.incomeCents, 0, "gap income")

let withPhone = household + [
    b("2026-08-11", "Telekom Deutschland", -3495, .expense, "Abos & Verträge"),
    b("2026-09-11", "Telekom Deutschland", -3495, .expense, "Abos & Verträge"),
]
equal(Budget.available(withPhone, today: "2026-10-11").upcoming.first { $0.name == "Telekom Deutschland" },
      Due(name: "Telekom Deutschland", date: "2026-10-12", amountCents: 3495), "sunday debit moves to monday")

equal(Budget.canAfford(a, amountCents: 5000).verdict, .locker, "locker")
let geht = Budget.canAfford(a, amountCents: 40000)
equal(geht.verdict, .geht, "geht")
equal(geht.afterCents, 127002, "after")
equal(geht.perDayAfterCents, 5291, "per day after")
equal(Budget.canAfford(a, amountCents: 150000).verdict, .knapp, "knapp")
equal(Budget.canAfford(a, amountCents: 200000).verdict, .nein, "nein")
equal(Budget.canAfford(a, amountCents: 200000).afterCents, -32998, "nein after")

// MARK: Import of the demo file (erwartet.json, hand-checked)

var ledger = Ledger()
let demo = try! ledger.importFile(sample("demo-umsaetze.csv"), filename: "demo-umsaetze.csv")
equal(demo.inserted, 44, "demo rows inserted")
equal(demo.duplicates, 0, "demo duplicates")
equal(demo.rejected.count, 0, "demo rejected")
equal(demo.total, 44, "demo total")
equal(ledger.transactions.reduce(0) { $0 + $1.amountCents }, 406905, "demo sum")
let again = try! ledger.importFile(sample("demo-umsaetze.csv"), filename: "demo-umsaetze.csv")
equal(again.inserted, 0, "re-import inserts nothing")
equal(again.duplicates, 44, "re-import: all duplicates")
equal(ledger.transactions.count, 44, "still 44 rows")
for (month, income, expense, transfer, rows) in [("2026-08", 387140, -201545, -30000, 21), ("2026-09", 412140, -190830, -30000, 23)] {
    let inMonth = ledger.transactions.filter { Day.month($0.bookingDate) == month }
    equal(inMonth.count, rows, "\(month) rows")
    equal(inMonth.filter { $0.amountCents > 0 }.reduce(0) { $0 + $1.amountCents }, income, "\(month) income")
    // erwartet.json counts transfers inside the expenses; the app files them apart (checked below).
    equal(inMonth.filter { $0.amountCents < 0 }.reduce(0) { $0 + $1.amountCents }, expense, "\(month) expenses incl. transfers")
    let summary = Budget.monthSummary(ledger.bookings(), month: month)
    equal(summary.transferCents, transfer, "\(month) transfers filed apart")
    equal(summary.expenseCents, expense - transfer, "\(month) expenses without transfers")
}
check(ledger.transactions.allSatisfy { $0.categoryId != nil || $0.needsReview }, "uncategorised rows are marked for review")
check(!ledger.transactions.contains { $0.categorySource == .manual }, "nothing manual after import")
let rewe = ledger.transactions.first { $0.counterparty.lowercased().contains("rewe") }
equal(ledger.category(rewe?.categoryId)?.name, "Lebensmittel", "known merchant REWE")
let salary = ledger.transactions.first { $0.counterparty == "Arbeitgeber Muster GmbH" }
equal(ledger.category(salary?.categoryId)?.name, "Einkommen", "salary by wording (Gehalt)")
equal(ledger.category(ledger.transactions.first { $0.counterparty == "Familienkasse" }?.categoryId)?.name, "Einkommen", "Kindergeld is income")
equal(ledger.category(ledger.transactions.first { $0.counterparty == "Eigenes Tagesgeld" }?.categoryId)?.name, "Umbuchung", "savings transfer by wording")
check(ledger.transactions.first { $0.counterparty == "Club Hafen" }?.needsReview == true, "unknown payee needs review, nothing guessed")
equal(Categorize.knownMerchantCategory(counterparty: "Deutsche Rentenversicherung", purpose: "Rente 10/2026", amountCents: 142000), "Einkommen", "pension is income")
check(Categorize.knownMerchantCategory(counterparty: "Max Muster", purpose: "Gehalt Rückzahlung", amountCents: -5000) == nil, "outgoing 'Gehalt' is not income")

// Review decision: category becomes a rule, all rows of that payee follow, manual stays.
if let club = ledger.transactions.first(where: { $0.counterparty == "Club Hafen" }) {
    ledger.setCategory(transactionId: club.id, categoryId: "Freizeit")
    check(ledger.transactions.first { $0.id == club.id }?.isManual == true, "manual after choice")
    equal(ledger.rules.count, 1, "one rule created")
    equal(ledger.rules.first?.pattern, "Club Hafen", "rule on the counterparty")
}
let sept = ledger.available(today: "2026-09-20")
equal(sept.nextIncome?.date, "2026-10-01", "salary detected after two months: next payday")
equal(sept.upcoming.map(\.name).contains("Eigenes Tagesgeld"), false, "savings transfer of 15.9. already booked")
check(sept.savedCents == 30000, "savings transfer counted as saved, got \(sept.savedCents)")

// Bank samples: every row is booked or pending, nothing rejected, sums match erwartet.json
struct Expected: Decodable {
    var profile: String
    var rows_total: Int
    var booked: Int
    var pending: Int
    var sum_cents: Int
    var footer_lines: Int?
}
let expectedBanks = try! JSONDecoder().decode([String: Expected].self, from: sample("banken/erwartet.json").filteringHint())
for (name, e) in expectedBanks.sorted(by: { $0.key < $1.key }) where name.hasSuffix(".csv") && !name.contains("kontoflow") {
    let result = try? Import.read(sample("banken/\(name)"))
    check(result != nil, "\(name) is readable")
    guard let result else { continue }
    equal(result.rejected.count, 0, "\(name) rejected")
    equal(result.rows.count, e.booked, "\(name) booked")
    equal(result.skipped.count, e.pending + (e.footer_lines ?? 0), "\(name) pending + footer")
    equal(result.rows.reduce(0) { $0 + $1.amountCents }, e.sum_cents, "\(name) sum")
    check(result.rows.allSatisfy { !$0.counterparty.isEmpty }, "\(name) every row has a counterparty")
}
let dkb = try! Import.read(sample("banken/dkb.csv"))
equal(dkb.rows.first { $0.amountCents == -5495 }?.counterparty, "Zalando SE", "DKB payee by direction")
equal(dkb.rows.first { $0.amountCents == 41200 }?.counterparty, "Finanzamt Beispielstadt", "DKB payer by direction")
let sparkasse = try! Import.read(sample("banken/sparkasse.csv"))
equal(sparkasse.rows.filter { $0.counterparty == "Bäckerei Müller" }.count, 2, "Sparkasse: Windows-1252 umlauts, two real identical card payments")
check(sparkasse.skipped.first?.reason.contains("vorgemerkt") == true, "Sparkasse pending row skipped with reason")
equal(sparkasse.ownIban, "DE00100500000000123456", "Sparkasse own IBAN from column")
let ing = try! Import.read(sample("banken/ing.csv"))
equal(ing.rows.first { $0.counterparty.hasPrefix("Deutsche Bahn") }?.amountCents, -4290, "ING amount not balance")
let comdirect = try! Import.read(sample("banken/neu/umsaetze_1234567890_20261008-2114.csv"))
equal(comdirect.rows.first { $0.amountCents == -3498 }?.counterparty, "Thalia Bücher", "comdirect counterparty from text")
let sollHaben = try! Import.read(sample("banken/neu/Kontoumsaetze_100_1234567_00_20261008.csv"))
equal(sollHaben.rows.first { $0.counterparty == "Tierarztpraxis Pfote" }?.amountCents, -8960, "Soll negative")
equal(sollHaben.rows.first { $0.purpose == "Rente 10/2026" }?.amountCents, 142000, "Haben positive")
check((try? Import.read(sample("banken/neu/kontoflow-export.csv"))) == nil, "unknown columns are refused, not guessed")
check((try? Import.read(Data("hello\nworld".utf8))) == nil, "no table → error")

// Capture into the ledger
var voice = Ledger()
let doener = voice.capture("hab 7 Euro für Döner gezahlt", now: noon)
equal(doener.transaction.amountCents, -700, "voice amount")
equal(doener.transaction.counterparty, "Döner", "voice payee")
equal(doener.transaction.bookingDate, "2026-10-21", "voice date")
check(doener.transaction.needsReview, "unknown payee → review")
check(!doener.draft, "not a draft")
let draft = voice.capture("hab einen Döner gekauft", now: noon)
check(draft.draft && draft.transaction.amountCents == 0 && draft.transaction.needsReview, "no amount → draft under review")
equal(draft.transaction.captureText, "hab einen Döner gekauft", "sentence kept")
let reweVoice = voice.capture("12,30 bei Rewe", now: noon)
equal(voice.category(reweVoice.transaction.categoryId)?.name, "Lebensmittel", "known merchant by voice")
check(!reweVoice.transaction.needsReview, "certain amount and known payee → no review")
let doubtful = voice.capture("zwei Döner bei Rewe", now: noon)
check(doubtful.transaction.needsReview, "doubtful amount stays on review even with a category")
voice.setCategory(transactionId: doener.transaction.id, categoryId: "Restaurant & Lieferdienst")
check(voice.transactions.first { $0.id == doener.transaction.id }?.isManual == true, "manual after choice")
check(voice.transactions.first { $0.id == draft.transaction.id }?.categoryId == "Restaurant & Lieferdienst", "rule applies to the draft with the same payee")
check(voice.transactions.first { $0.id == draft.transaction.id }?.needsReview == true, "draft without amount stays on review")

// Ledger round trip through JSON
let encoded = try! JSONEncoder().encode(ledger)
let decoded = try! JSONDecoder().decode(Ledger.self, from: encoded)
equal(decoded.transactions.count, ledger.transactions.count, "ledger survives JSON")
equal(decoded.rules.count, ledger.rules.count, "rules survive JSON")

print(failures == 0 ? "OK: \(checks) checks" : "FAILED: \(failures) of \(checks) checks")
exit(failures == 0 ? 0 : 1)

extension Data {
    /// erwartet.json carries a "_hinweis" string next to the objects; drop it before decoding.
    func filteringHint() -> Data {
        var object = try! JSONSerialization.jsonObject(with: self) as! [String: Any]
        object["_hinweis"] = nil
        return try! JSONSerialization.data(withJSONObject: object)
    }
}
