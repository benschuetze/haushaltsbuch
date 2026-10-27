import Foundation

// "How much can I spend today?" The app does not know the account balance (CSV exports rarely carry it), so it
// answers per pay period: what came in since the last salary, minus what went out, minus what is still due
// before the next salary (fixed costs, subscriptions, the savings transfer). Spread over the days left.
// Ported from app/lib/budget/available.ts and app/lib/insights/recurring.ts; the TypeScript tests are the reference.

struct Booking {
    var bookingDate: String
    var amountCents: Int
    var counterparty: String
    var purpose: String
    var categoryName: String?
    var categoryKind: CategoryKind?
}

struct Due: Equatable {
    var name: String
    var date: String
    var amountCents: Int
}

struct Available {
    var today: String
    var periodStart: String
    /// Last day before the next salary (or the month's last day when no salary is known).
    var periodEnd: String
    var daysLeft: Int
    var nextIncome: Due?
    /// The salary that should have started this period but is not in the bookings yet (export not imported?).
    var missingIncome: Due?
    var incomeCents: Int
    var spentCents: Int
    /// This period's savings transfers that already went out: planned money, gone like a paid bill.
    var savedCents: Int
    var upcoming: [Due]
    var upcomingCents: Int
    /// May be negative: then the period is already overdrawn.
    var freeCents: Int
    var perDayCents: Int
}

enum Cadence: String {
    case weekly, monthly, quarterly, yearly

    var perYear: Int { switch self { case .weekly: 52; case .monthly: 12; case .quarterly: 4; case .yearly: 1 } }
    var days: Int { switch self { case .weekly: 7; case .monthly: 30; case .quarterly: 91; case .yearly: 365 } }

    func step(_ day: String) -> String {
        switch self {
        case .weekly: Day.addDays(day, 7)
        case .monthly: Day.addMonths(day, 1)
        case .quarterly: Day.addMonths(day, 3)
        case .yearly: Day.addMonths(day, 12)
        }
    }
}

struct Recurring {
    var merchant: String
    var categoryName: String?
    var cadence: Cadence
    /// Latest amount, negative like the bookings.
    var lastAmountCents: Int
    var previousAmountCents: Int?
    var lastDate: String
    var occurrences: Int
    var yearlyCents: Int
    var active: Bool
    /// Fixed costs (rent, insurance) versus subscriptions one could cancel.
    var isFixed: Bool
    /// Same amount every time (within 5 %): a debit that can be planned with, unlike fuel or shopping.
    var stable: Bool
}

enum Merchants {
    static func merchantOf(counterparty: String, purpose: String) -> String {
        if Categorize.isAggregator(counterparty) {
            if let m = purpose.firstMatch("PP\\.\\d+\\.PP\\s*\\.\\s*([^,]+)", options: [.caseInsensitive]) {
                return m[1].trimmingCharacters(in: .whitespaces)
            }
            return (purpose.split(separator: ",", maxSplits: 1).first.map(String.init) ?? purpose).trimmingCharacters(in: .whitespaces)
        }
        return counterparty.trimmingCharacters(in: .whitespaces)
    }

    /// "Spotify AB" and "SPOTIFY" are the same merchant; legal forms and reference numbers are noise.
    static func key(_ name: String) -> String {
        name.lowercased()
            .replacingOccurrences(of: "\\b(gmbh|ag|se|ab|inc|ltd|bv|b\\.v\\.|s\\.a\\.r\\.l\\.?|e\\.v\\.|pbc|kg|co|international|deutschland|europe|eu)\\b", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "[^a-zäöüß]+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    static let serviceGroups: [[String]] = [
        ["netflix", "disney", "prime video|amazon prime", "\\bwow\\b|sky ticket", "paramount", "apple tv", "rtl\\+|joyn"],
        ["spotify", "apple music", "deezer", "tidal", "youtube music|youtube premium", "amazon music"],
        ["icloud", "google one|google storage", "dropbox", "onedrive|microsoft 365"],
        ["anthropic|claude", "openai|chatgpt", "perplexity", "mistral|le chat"],
        ["audible", "bookbeat", "nextory", "storytel"],
    ]

    static func isKnownService(_ merchant: String, purpose: String) -> Bool {
        let text = "\(merchant) \(purpose)".lowercased()
        return serviceGroups.contains { $0.contains { text.matches($0, options: []) } }
    }
}

enum Budget {
    private static let fixedCategories: Set<String> = ["Wohnen", "Versicherungen", "Kind & Kita", "Mobilität"]
    private static let neverRecurring: Set<String> = ["Lebensmittel", "Umbuchung", "Einkommen"]

    private static func median(_ values: [Int]) -> Int {
        let sorted = values.sorted()
        return sorted.isEmpty ? 0 : sorted[sorted.count / 2]
    }

    private static func within5(_ values: [Int]) -> Bool {
        let m = Double(median(values))
        return values.allSatisfy { abs(Double($0) - m) <= m * 0.05 }
    }

    /// Plannable: the same amount every time, or one price change and the same amount since then.
    private static func atMostOneStep(_ chronological: [Int]) -> Bool {
        if within5(chronological) { return true }
        // At least two equal payments before the change, otherwise two different amounts would count as a "step".
        for cut in 2..<max(2, chronological.count) {
            if within5(Array(chronological[..<cut])) && within5(Array(chronological[cut...])) { return true }
        }
        return false
    }

    private static func cadenceOf(_ gaps: [Int]) -> Cadence? {
        let m = median(gaps)
        if (6...8).contains(m) { return .weekly }
        if (26...35).contains(m) { return .monthly }
        if (84...98).contains(m) { return .quarterly }
        if (350...380).contains(m) { return .yearly }
        return nil
    }

    private static func grouped(_ bookings: [Booking], include: (Booking) -> Bool) -> [String: [Booking]] {
        var groups: [String: [Booking]] = [:]
        for b in bookings where include(b) {
            let key = Merchants.key(Merchants.merchantOf(counterparty: b.counterparty, purpose: b.purpose))
            if key.isEmpty { continue }
            groups[key, default: []].append(b)
        }
        return groups.mapValues { $0.sorted { $0.bookingDate < $1.bookingDate } }
    }

    /// Same merchant, regular rhythm, stable amount. Groceries and transfers are left out on purpose:
    /// buying bread every week is not a subscription.
    static func detectRecurring(_ bookings: [Booking], referenceDate: String) -> [Recurring] {
        let groups = grouped(bookings) { $0.amountCents < 0 && !neverRecurring.contains($0.categoryName ?? "") }
        var result: [Recurring] = []
        for items in groups.values where items.count >= 2 {
            let gaps = zip(items, items.dropFirst()).map { Day.daysBetween($0.bookingDate, $1.bookingDate) }
            guard let cadence = cadenceOf(gaps) else { continue }
            // Two bookings in the same week are not a weekly rhythm unless there are more of them.
            if cadence == .weekly && items.count < 4 { continue }
            let last = items[items.count - 1]
            // Two equal purchases a month apart are often chance. Two payments are enough only for
            // known services or what is already filed as a subscription.
            if items.count < 3 && last.categoryName != "Abos & Verträge"
                && !Merchants.isKnownService(Merchants.merchantOf(counterparty: last.counterparty, purpose: last.purpose), purpose: last.purpose) {
                continue
            }
            let amounts = items.map { abs($0.amountCents) }
            let m = Double(median(amounts))
            if amounts.contains(where: { abs(Double($0) - m) > m * 0.25 }) { continue }
            let previous = items.count >= 2 ? items[items.count - 2] : nil
            let isFixed = fixedCategories.contains(last.categoryName ?? "") || abs(last.amountCents) > 10_000
            result.append(Recurring(
                merchant: Merchants.merchantOf(counterparty: last.counterparty, purpose: last.purpose),
                categoryName: last.categoryName,
                cadence: cadence,
                lastAmountCents: last.amountCents,
                previousAmountCents: previous?.amountCents,
                lastDate: last.bookingDate,
                occurrences: items.count,
                yearlyCents: abs(last.amountCents) * cadence.perYear,
                active: Double(Day.daysBetween(last.bookingDate, referenceDate)) <= Double(cadence.days) * 1.5,
                isFixed: isFixed,
                stable: atMostOneStep(amounts)
            ))
        }
        return result.sorted { $0.yearlyCents > $1.yearlyCents }
    }

    /// The largest income that arrives every month; its next date is the next payday.
    private static func findSalary(_ bookings: [Booking], today: String) -> (name: String, last: String, amountCents: Int)? {
        let groups = grouped(bookings) { $0.amountCents > 0 && $0.categoryKind == .income && $0.bookingDate <= today }
        var best: (name: String, last: String, amountCents: Int)?
        for items in groups.values where items.count >= 2 {
            let gaps = zip(items, items.dropFirst()).map { Day.daysBetween($0.bookingDate, $1.bookingDate) }
            guard gaps.allSatisfy({ $0 >= 25 && $0 <= 36 }) else { continue }
            let last = items[items.count - 1]
            // Too long ago: the job may have ended, better not plan with it.
            if Day.daysBetween(last.bookingDate, today) > 40 { continue }
            if best == nil || last.amountCents > best!.amountCents {
                best = (Merchants.merchantOf(counterparty: last.counterparty, purpose: last.purpose), last.bookingDate, last.amountCents)
            }
        }
        return best
    }

    // Card and PayPal settlements are transfers too, but the purchases behind them are already counted.
    private static let settlement = "american express|amex|kreditkarte|kartenabrechnung"

    /// Outgoing transfers to own savings every month are planned money, not free money.
    private static func monthlyTransfers(_ bookings: [Booking], today: String) -> [(key: String, last: Booking)] {
        let groups = grouped(bookings) {
            $0.amountCents < 0 && $0.categoryKind == .transfer && $0.bookingDate <= today
                && !Categorize.isAggregator($0.counterparty) && !"\($0.counterparty) \($0.purpose)".matches(settlement)
        }
        return groups.filter { $0.value.count >= 2 }
            .map { (key: $0.key, last: $0.value[$0.value.count - 1]) }
            .filter { Day.daysBetween($0.last.bookingDate, today) <= 40 }
            .sorted { $0.key < $1.key }
    }

    static func available(_ bookings: [Booking], today: String) -> Available {
        let salary = findSalary(bookings, today: today)
        var periodStart: String
        var nextIncome: Due?
        var missingIncome: Due?
        if let salary {
            periodStart = salary.last
            var next = Day.addMonths(salary.last, 1)
            // A salary a few days late is still expected. Past that, the period starts on the payday that passed
            // without a booking (two months in one pot would look like double money) and the gap is reported.
            while Day.daysBetween(next, today) > 5 {
                periodStart = next
                missingIncome = Due(name: salary.name, date: next, amountCents: salary.amountCents)
                next = Day.addMonths(next, 1)
            }
            // Due on a Sunday or a holiday, it arrives on the next bank day; the period runs until then.
            nextIncome = Due(name: salary.name, date: Day.bankDay(next), amountCents: salary.amountCents)
        } else {
            periodStart = Day.firstOfMonth(today)
        }
        let periodEnd: String
        if let nextIncome, nextIncome.date > today {
            periodEnd = Day.addDays(nextIncome.date, -1)
        } else {
            periodEnd = Day.addDays(Day.addMonths(Day.firstOfMonth(today), 1), -1)
        }
        let daysLeft = max(1, Day.daysBetween(today, periodEnd) + 1)

        let inPeriod = bookings.filter { $0.bookingDate >= periodStart && $0.bookingDate <= today }
        let incomeCents = inPeriod.filter { $0.amountCents > 0 && $0.categoryKind != .transfer }.reduce(0) { $0 + $1.amountCents }
        let spentCents = inPeriod.filter { $0.amountCents < 0 && $0.categoryKind != .transfer }.reduce(0) { $0 - $1.amountCents }

        let transfers = monthlyTransfers(bookings, today: today)
        let planned = Set(transfers.map(\.key))
        // Without this, the savings transfer would count as due until it is booked and then as nothing at all:
        // the daily amount would jump up by the rate on the day the money leaves.
        let savedCents = inPeriod
            .filter { $0.amountCents < 0 && $0.categoryKind == .transfer && planned.contains(Merchants.key(Merchants.merchantOf(counterparty: $0.counterparty, purpose: $0.purpose))) }
            .reduce(0) { $0 - $1.amountCents }

        var upcoming: [Due] = []
        // Only what can be planned with: a stable amount. Fuel or a regular shop vary and stay in "spent".
        let recurring = detectRecurring(bookings.filter { $0.bookingDate <= today }, referenceDate: today).filter { $0.active && $0.stable }
        for r in recurring {
            var nominal = r.cadence.step(r.lastDate)
            // A debit due on a weekend or holiday is executed on the next bank day: that decides the period it falls in.
            var due = Day.bankDay(nominal)
            while due <= periodEnd {
                if due > today || (due >= periodStart && r.lastDate < periodStart) {
                    upcoming.append(Due(name: r.merchant, date: due > today ? due : today, amountCents: abs(r.lastAmountCents)))
                }
                nominal = r.cadence.step(nominal)
                due = Day.bankDay(nominal)
            }
        }
        for t in transfers {
            let due = Day.bankDay(Day.addMonths(t.last.bookingDate, 1))
            if t.last.bookingDate < periodStart && due <= periodEnd {
                upcoming.append(Due(name: Merchants.merchantOf(counterparty: t.last.counterparty, purpose: t.last.purpose), date: due > today ? due : today, amountCents: -t.last.amountCents))
            }
        }
        // Stable sort by date, like Array.prototype.sort with a comparator.
        upcoming = upcoming.enumerated().sorted { a, b in a.element.date != b.element.date ? a.element.date < b.element.date : a.offset < b.offset }.map(\.element)
        let upcomingCents = upcoming.reduce(0) { $0 + $1.amountCents }
        let freeCents = incomeCents - spentCents - savedCents - upcomingCents
        return Available(
            today: today, periodStart: periodStart, periodEnd: periodEnd, daysLeft: daysLeft,
            nextIncome: nextIncome, missingIncome: missingIncome, incomeCents: incomeCents, spentCents: spentCents,
            savedCents: savedCents, upcoming: upcoming, upcomingCents: upcomingCents, freeCents: freeCents,
            perDayCents: freeCents > 0 ? freeCents / daysLeft : 0
        )
    }

    enum Verdict: String {
        case locker, geht, knapp, nein
    }

    struct Affordability {
        var verdict: Verdict
        var amountCents: Int
        var afterCents: Int
        var perDayAfterCents: Int
    }

    /// "Can I afford X?" Locker: fits into today's share. Geht: costs some of the coming days, at least half of the
    /// daily amount stays. Knapp: still within the period, but the rest gets thin. Nein: the period would go negative.
    static func canAfford(_ a: Available, amountCents: Int) -> Affordability {
        let afterCents = a.freeCents - amountCents
        let perDayAfterCents = afterCents > 0 ? afterCents / a.daysLeft : 0
        let verdict: Verdict
        if afterCents < 0 { verdict = .nein }
        else if amountCents <= a.perDayCents { verdict = .locker }
        else if Double(perDayAfterCents) >= Double(a.perDayCents) / 2 { verdict = .geht }
        else { verdict = .knapp }
        return Affordability(verdict: verdict, amountCents: amountCents, afterCents: afterCents, perDayAfterCents: perDayAfterCents)
    }

    /// Income, spending and transfers of one month, transfers kept apart like the web app's month view.
    struct MonthSummary {
        var month: String
        var incomeCents: Int
        var expenseCents: Int
        var transferCents: Int
        var byCategory: [(name: String, cents: Int, count: Int)]
    }

    static func monthSummary(_ bookings: [Booking], month: String) -> MonthSummary {
        var income = 0, expense = 0, transfer = 0
        var cats: [String: (cents: Int, count: Int)] = [:]
        for b in bookings where Day.month(b.bookingDate) == month {
            if b.categoryKind == .transfer { transfer += b.amountCents; continue }
            if b.amountCents > 0 { income += b.amountCents } else { expense += b.amountCents }
            let name = b.categoryName ?? "ohne Kategorie"
            let cur = cats[name] ?? (0, 0)
            cats[name] = (cur.cents + b.amountCents, cur.count + 1)
        }
        let list = cats.map { (name: $0.key, cents: $0.value.cents, count: $0.value.count) }.sorted { $0.cents < $1.cents }
        return MonthSummary(month: month, incomeCents: income, expenseCents: expense, transferCents: transfer, byCategory: list)
    }
}
