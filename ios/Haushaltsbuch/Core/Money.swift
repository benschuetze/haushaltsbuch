import Foundation

// Amounts are integer cents end to end. Parsing goes through strings so no float ever touches a balance.
// Ported from app/lib/money.ts; the TypeScript tests are the reference.

enum MoneyError: Error, CustomStringConvertible {
    case invalidAmount(String)
    case invalidDate(String)

    var description: String {
        switch self {
        case .invalidAmount(let s): return "Ungültiger Betrag: \"\(s)\""
        case .invalidDate(let s): return "Ungültiges Datum: \"\(s)\""
        }
    }
}

enum DecimalStyle: String, Codable {
    case de, en
}

enum Money {
    private static let currencySuffix = try! NSRegularExpression(pattern: "\\s*(?:€|EUR)$", options: [.caseInsensitive])
    private static let german = try! NSRegularExpression(pattern: "^([+-])?\\s*(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,(\\d{1,2}))?$")
    private static let english = try! NSRegularExpression(pattern: "^([+-])?\\s*(\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.(\\d{1,2}))?$")

    private static func stripCurrency(_ input: String) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespaces)
        return currencySuffix.stringByReplacingMatches(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed), withTemplate: "")
    }

    private static func parse(_ input: String, with regex: NSRegularExpression, thousands: String) throws -> Int {
        let text = stripCurrency(input)
        guard let m = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else {
            throw MoneyError.invalidAmount(input)
        }
        let sign = text.group(m, 1)
        let intPart = text.group(m, 2).replacingOccurrences(of: thousands, with: "")
        let fraction = text.group(m, 3).padding(toLength: 2, withPad: "0", startingAt: 0)
        guard let euros = Int(intPart), let cents = Int(fraction), euros < 90_000_000_000_000 else {
            throw MoneyError.invalidAmount(input)
        }
        let total = euros * 100 + cents
        return sign == "-" ? -total : total
    }

    static func parseGermanAmount(_ input: String) throws -> Int {
        try parse(input, with: german, thousands: ".")
    }

    /// Like parseGermanAmount, for exports with a decimal point (N26 and other international banks).
    static func parseEnglishAmount(_ input: String) throws -> Int {
        try parse(input, with: english, thousands: ",")
    }

    static func parseAmount(_ input: String, style: DecimalStyle) throws -> Int {
        style == .de ? try parseGermanAmount(input) : try parseEnglishAmount(input)
    }

    /// Decides the decimal separator from sample values. "1.234" alone is ambiguous, so only values with exactly
    /// two digits after the last separator count as evidence.
    static func detectDecimalStyle(_ samples: [String]) -> DecimalStyle? {
        var de = 0
        var en = 0
        for raw in samples {
            let v = stripCurrency(raw)
            if v.range(of: ",\\d{2}$", options: .regularExpression) != nil { de += 1 }
            else if v.range(of: "\\.\\d{2}$", options: .regularExpression) != nil { en += 1 }
        }
        if de == 0 && en == 0 { return nil }
        return de >= en ? .de : .en
    }

    /// "−1.234,56 €": German formatting with a real minus sign, like the web app.
    static func format(_ cents: Int, currency: String = "EUR") -> String {
        let negative = cents < 0
        let abs = Swift.abs(cents)
        var euros = String(abs / 100)
        var grouped = ""
        while euros.count > 3 {
            grouped = "." + euros.suffix(3) + grouped
            euros = String(euros.dropLast(3))
        }
        let rest = String(format: "%02d", abs % 100)
        let symbol = currency == "EUR" ? "€" : currency
        return "\(negative ? "−" : "")\(euros)\(grouped),\(rest) \(symbol)"
    }

    private static let germanDate = try! NSRegularExpression(pattern: "^(\\d{1,2})\\.(\\d{1,2})\\.(\\d{2}|\\d{4})$")

    /// dd.mm.yyyy or dd.mm.yy → yyyy-mm-dd. Two-digit years are read as 20yy, bank exports never reach back further.
    static func parseGermanDate(_ input: String) throws -> String {
        let text = input.trimmingCharacters(in: .whitespaces)
        guard let m = germanDate.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let day = Int(text.group(m, 1)), let month = Int(text.group(m, 2)), var year = Int(text.group(m, 3))
        else { throw MoneyError.invalidDate(input) }
        if text.group(m, 3).count == 2 { year += 2000 }
        guard let iso = Day.iso(year: year, month: month, day: day) else { throw MoneyError.invalidDate(input) }
        return iso
    }

    /// German dates, ISO dates, and dd/mm/yyyy. Anything else is an error, never a guess.
    static func parseDate(_ input: String) throws -> String {
        let v = input.trimmingCharacters(in: .whitespaces)
        if let m = v.firstMatch("^(\\d{4})-(\\d{2})-(\\d{2})$") {
            return try parseGermanDate("\(m[3]).\(m[2]).\(m[1])")
        }
        if let m = v.firstMatch("^(\\d{1,2})/(\\d{1,2})/(\\d{2}|\\d{4})$") {
            return try parseGermanDate("\(m[1]).\(m[2]).\(m[3])")
        }
        return try parseGermanDate(v)
    }
}

extension String {
    func group(_ match: NSTextCheckingResult, _ index: Int) -> String {
        guard index < match.numberOfRanges, let range = Range(match.range(at: index), in: self) else { return "" }
        return String(self[range])
    }

    /// Capture groups of the first match (index 0 is the whole match), or nil.
    func firstMatch(_ pattern: String, options: NSRegularExpression.Options = []) -> [String]? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: options),
              let m = regex.firstMatch(in: self, range: NSRange(startIndex..., in: self)) else { return nil }
        return (0..<m.numberOfRanges).map { group(m, $0) }
    }

    func matches(_ pattern: String, options: NSRegularExpression.Options = [.caseInsensitive]) -> Bool {
        range(of: pattern, options: options.contains(.caseInsensitive) ? [.regularExpression, .caseInsensitive] : [.regularExpression]) != nil
    }
}
