import Foundation

/// Calendar days as "yyyy-mm-dd" strings, compared lexicographically, with no time zone attached: a booking
/// date is a date, and "heute" is the day in Germany. Ported from available.ts, bank-day.ts and run.ts.
enum Day {
    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    static func iso(year: Int, month: Int, day: Int) -> String? {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = day
        guard let date = utc.date(from: comps) else { return nil }
        let back = utc.dateComponents([.year, .month, .day], from: date)
        guard back.year == year, back.month == month, back.day == day else { return nil }
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    static func date(_ iso: String) -> Date {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        var comps = DateComponents()
        comps.year = parts.count > 0 ? parts[0] : 1970
        comps.month = parts.count > 1 ? parts[1] : 1
        comps.day = parts.count > 2 ? parts[2] : 1
        return utc.date(from: comps) ?? Date(timeIntervalSince1970: 0)
    }

    static func iso(_ date: Date) -> String {
        let c = utc.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 1970, c.month ?? 1, c.day ?? 1)
    }

    /// The calendar day in Germany, because "heute" at 01:30 is not yesterday's UTC date.
    static func today(now: Date = Date()) -> String {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Berlin")!
        let p = c.dateComponents([.year, .month, .day], from: now)
        return String(format: "%04d-%02d-%02d", p.year ?? 1970, p.month ?? 1, p.day ?? 1)
    }

    static func addDays(_ day: String, _ days: Int) -> String {
        iso(date(day).addingTimeInterval(TimeInterval(days) * 86_400))
    }

    /// Same day next month, clamped: 31 Jan + 1 month = 28/29 Feb.
    static func addMonths(_ day: String, _ months: Int) -> String {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return day }
        var y = parts[0]
        var m = parts[1] - 1 + months
        y += Int(floor(Double(m) / 12))
        m = ((m % 12) + 12) % 12
        let last = daysInMonth(year: y, month: m + 1)
        return String(format: "%04d-%02d-%02d", y, m + 1, min(parts[2], last))
    }

    static func daysInMonth(year: Int, month: Int) -> Int {
        var comps = DateComponents()
        comps.year = year
        comps.month = month
        comps.day = 1
        let first = utc.date(from: comps) ?? Date()
        return utc.range(of: .day, in: .month, for: first)?.count ?? 30
    }

    static func daysBetween(_ a: String, _ b: String) -> Int {
        Int((date(b).timeIntervalSince(date(a)) / 86_400).rounded())
    }

    /// 1 = Sunday … 7 = Saturday, like Calendar.
    static func weekday(_ day: String) -> Int {
        utc.component(.weekday, from: date(day))
    }

    static func month(_ day: String) -> String {
        String(day.prefix(7))
    }

    static func firstOfMonth(_ day: String) -> String {
        month(day) + "-01"
    }

    // MARK: Bank days (TARGET2: Monday to Friday, without nationwide holidays, 24 and 31 December)

    /// Easter Sunday, anonymous Gregorian algorithm (Meeus/Jones/Butcher).
    private static func easter(_ year: Int) -> String {
        let a = year % 19, b = year / 100, c = year % 100, d = b / 4, e = b % 4
        let f = (b + 8) / 25, g = (b - f + 1) / 3
        let h = (19 * a + b - d - g + 15) % 30
        let i = c / 4, k = c % 4
        let l = (32 + 2 * e + 2 * i - h - k) % 7
        let m = (a + 11 * h + 22 * l) / 451
        let month = (h + l - 7 * m + 114) / 31
        let day = ((h + l - 7 * m + 114) % 31) + 1
        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private static var holidayCache: [Int: Set<String>] = [:]

    private static func closedDays(_ year: Int) -> Set<String> {
        if let cached = holidayCache[year] { return cached }
        let e = easter(year)
        let days: Set<String> = [
            "\(year)-01-01",
            addDays(e, -2), // Karfreitag
            addDays(e, 1), // Ostermontag
            "\(year)-05-01",
            addDays(e, 39), // Christi Himmelfahrt
            addDays(e, 50), // Pfingstmontag
            "\(year)-10-03",
            "\(year)-12-24",
            "\(year)-12-25",
            "\(year)-12-26",
            "\(year)-12-31",
        ]
        holidayCache[year] = days
        return days
    }

    static func isBankDay(_ day: String) -> Bool {
        let wd = weekday(day)
        return wd != 1 && wd != 7 && !closedDays(Int(day.prefix(4)) ?? 2000).contains(day)
    }

    /// The date itself if banks work that day, otherwise the next day they do.
    static func bankDay(_ day: String) -> String {
        var d = day
        while !isBankDay(d) { d = addDays(d, 1) }
        return d
    }

    /// "9. Oktober" for the UI.
    static func long(_ day: String) -> String {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return day }
        let months = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"]
        return "\(parts[2]). \(months[max(0, min(11, parts[1] - 1))])"
    }

    /// "09.10.2026" for lists.
    static func short(_ day: String) -> String {
        let parts = day.split(separator: "-")
        guard parts.count == 3 else { return day }
        return "\(parts[2]).\(parts[1]).\(parts[0])"
    }
}
