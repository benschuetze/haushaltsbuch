import Foundation

// Reads a money amount out of a dictated sentence. The quick capture books a payment from one spoken sentence and
// must not ask back, so this parser is generous: it takes digits, number words ("sieben fünfzig") and dictation
// quirks. The only hard failure is a sentence without any number. A reading that could be wrong is returned with
// certain=false so the caller files the booking under "prüfen" instead of guessing silently.
// Ported from app/lib/capture/amount.ts and number-words.ts; the TypeScript test cases are the reference.

struct SpokenAmount: Equatable {
    var cents: Int
    var certain: Bool
}

enum NumberWords {
    private static let units: [String: Int] = [
        "eins": 1, "ein": 1, "eine": 1, "zwei": 2, "drei": 3, "vier": 4, "funf": 5, "sechs": 6, "sieben": 7, "acht": 8,
        "neun": 9, "zehn": 10, "elf": 11, "zwolf": 12, "dreizehn": 13, "vierzehn": 14, "funfzehn": 15, "sechzehn": 16,
        "siebzehn": 17, "achtzehn": 18, "neunzehn": 19,
    ]
    private static let tens: [String: Int] = [
        "zwanzig": 20, "dreissig": 30, "vierzig": 40, "funfzig": 50, "fuffzig": 50, "sechzig": 60, "siebzig": 70,
        "achtzig": 80, "neunzig": 90,
    ]
    // Longest first, otherwise "sechs" would shadow "sechzehn" and "drei" would shadow "dreizehn".
    private static let atoms: [String] = (Array(units.keys) + Array(tens.keys) + ["hundert", "tausend", "und"])
        .sorted { $0.count > $1.count }

    /// Dictation writes "fünf", people type "fuenf"; both fold to the same ASCII form.
    static func fold(_ word: String) -> String {
        word.replacingOccurrences(of: "ä", with: "a").replacingOccurrences(of: "ö", with: "o")
            .replacingOccurrences(of: "ü", with: "u").replacingOccurrences(of: "ß", with: "ss")
            .replacingOccurrences(of: "ae", with: "a").replacingOccurrences(of: "oe", with: "o")
            .replacingOccurrences(of: "ue", with: "u")
    }

    /// One German number word ("einundzwanzig", "zweihundertdreiundvierzig") → integer, or nil if it is not one.
    static func parse(_ raw: String) -> Int? {
        let word = fold(raw)
        if word == "null" { return 0 }
        var pos = word.startIndex
        var total = 0, current = 0, pending = 0, consumed = 0
        var afterUnd = false
        while pos < word.endIndex {
            guard let atom = atoms.first(where: { word[pos...].hasPrefix($0) }) else { return nil }
            pos = word.index(pos, offsetBy: atom.count)
            consumed += 1
            if atom == "und" {
                if pending == 0 || afterUnd { return nil }
                afterUnd = true
            } else if let u = units[atom] {
                if pending > 0 || afterUnd { return nil }
                pending = u
            } else if let t = tens[atom] {
                if pending > 0 && !afterUnd { return nil }
                if afterUnd && pending == 0 { return nil }
                current += pending + t
                pending = 0
                afterUnd = false
            } else if atom == "hundert" {
                if current > 0 || afterUnd { return nil }
                current = (pending == 0 ? 1 : pending) * 100
                pending = 0
            } else {
                if afterUnd { return nil }
                let factor = current + pending
                total += (factor == 0 ? 1 : factor) * 1000
                current = 0
                pending = 0
            }
        }
        if consumed == 0 || afterUnd { return nil }
        return total + current + pending
    }
}

enum SpokenAmountParser {
    /// Above this the reading is probably a dictation error ("zweitausend" for "zwanzig"), so it is flagged.
    private static let maxCertainCents = 100_000 * 100
    private static let maxDigits = 9

    private enum Token {
        case num(int: Int, frac: Int?, word: Bool)
        case euro, cent, und, komma, article, other

        var number: (int: Int, frac: Int?, word: Bool)? {
            if case .num(let i, let f, let w) = self { return (i, f, w) }
            return nil
        }
    }

    private static let tokenPattern = try! NSRegularExpression(pattern: "\\d{1,2}\\.\\d{1,2}\\.(?:\\d{2,4})?|\\d{1,3}(?:\\.\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?|[a-zäöüß]+|€")

    private static func digitToken(_ text: String) -> Token {
        if text.matches("^\\d{1,2}\\.\\d{1,2}\\.(?:\\d{2,4})?$", options: []) { return .other }
        var intText = "", fracText: String?
        if let m = text.firstMatch("^(\\d{1,3}(?:\\.\\d{3})+)(?:,(\\d{1,2}))?$") {
            intText = m[1].replacingOccurrences(of: ".", with: "")
            fracText = m[2].isEmpty ? nil : m[2]
        } else if let m = text.firstMatch("^(\\d+)(?:[.,](\\d{1,2}))?$") {
            intText = m[1]
            fracText = m[2].isEmpty ? nil : m[2]
        }
        if intText.isEmpty || intText.count > maxDigits { return .other }
        guard let int = Int(intText) else { return .other }
        let frac = fracText.flatMap { Int($0.padding(toLength: 2, withPad: "0", startingAt: 0)) }
        return .num(int: int, frac: frac, word: false)
    }

    private static func wordToken(_ word: String) -> Token {
        let folded = NumberWords.fold(word)
        if ["euro", "eur", "euros"].contains(folded) { return .euro }
        if ["cent", "cents", "ct"].contains(folded) { return .cent }
        if folded == "und" { return .und }
        if folded == "komma" { return .komma }
        // Articles are mostly just articles ("ein Döner"); they only count as 1 in front of a unit.
        if ["ein", "eine", "einen", "einem", "einer", "nen"].contains(folded) { return .article }
        if folded == "anderthalb" { return .num(int: 1, frac: 50, word: true) }
        if folded.hasSuffix("einhalb"), folded.count > 7 {
            let whole = NumberWords.parse(String(folded.dropLast(7)))
            if let whole, whole > 0, whole <= 999_999 { return .num(int: whole, frac: 50, word: true) }
        }
        guard let value = NumberWords.parse(word), value <= 999_999_999 else { return .other }
        return .num(int: value, frac: nil, word: true)
    }

    private static func tokenize(_ text: String) -> [Token] {
        let lower = text.lowercased()
        return tokenPattern.matches(in: lower, range: NSRange(lower.startIndex..., in: lower)).map { m in
            let piece = lower.group(m, 0)
            if piece == "€" { return .euro }
            if piece.first?.isNumber == true { return digitToken(piece) }
            return wordToken(piece)
        }
    }

    /// "sieben komma fünf" → 7,50; "drei komma null fünf" → 3,05. Spoken digits after the comma are cents.
    private static func foldDecimals(_ tokens: [Token]) -> [Token] {
        var out: [Token] = []
        var i = 0
        while i < tokens.count {
            let token = tokens[i]
            if case .komma = token, let prev = out.last?.number, prev.frac == nil, i + 1 < tokens.count, let next = tokens[i + 1].number {
                if next.int == 0, i + 2 < tokens.count, let after = tokens[i + 2].number, after.int >= 1, after.int <= 9 {
                    out[out.count - 1] = .num(int: prev.int, frac: after.int, word: prev.word)
                    i += 3
                    continue
                }
                if next.int >= 1, next.int <= 99, next.frac == nil {
                    out[out.count - 1] = .num(int: prev.int, frac: next.int < 10 ? next.int * 10 : next.int, word: true)
                    i += 2
                    continue
                }
            }
            out.append(token)
            i += 1
        }
        return out.indices.map { i in
            if case .article = out[i] {
                if i + 1 < out.count, case .euro = out[i + 1] { return .num(int: 1, frac: nil, word: true) }
                if i + 1 < out.count, case .cent = out[i + 1] { return .num(int: 1, frac: nil, word: true) }
                return .other
            }
            return out[i]
        }
    }

    private static func findAmount(_ tokens: [Token]) -> SpokenAmount? {
        var used = Set<Int>()
        var amounts: [Int] = []
        func numAt(_ i: Int) -> (int: Int, frac: Int?, word: Bool)? {
            guard i >= 0, i < tokens.count, !used.contains(i) else { return nil }
            return tokens[i].number
        }
        func kind(_ i: Int) -> Token? { i >= 0 && i < tokens.count ? tokens[i] : nil }

        for (i, token) in tokens.enumerated() {
            guard case .euro = token else { continue }
            let source = numAt(i - 1) != nil ? i - 1 : (numAt(i + 1) != nil ? i + 1 : -1)
            guard let head = numAt(source) else { continue }
            used.insert(source)
            var cents = head.int * 100 + (head.frac ?? 0)
            if head.frac == nil && source == i - 1 {
                if let lead = numAt(i - 2), lead.frac == nil, lead.int >= 1, lead.int <= 99, head.int >= 10, head.int <= 99 {
                    // "sieben fünfzig Euro": the unit closes a spoken price, the first number is the euros.
                    cents = lead.int * 100 + head.int
                    used.insert(i - 2)
                } else {
                    var j = i + 1
                    if case .und? = kind(j) { j += 1 }
                    let unit: Bool = { if case .cent? = kind(j + 1) { return true } else { return false } }()
                    if let tail = numAt(j), tail.frac == nil, tail.int >= 1, tail.int <= 99, unit || tail.int >= 10 {
                        cents += tail.int
                        used.insert(j)
                        if unit { used.insert(j + 1) }
                    }
                }
            } else if head.frac == nil {
                // "EUR 7 50": the unit comes first, the cents follow the number.
                if let tail = numAt(i + 2), tail.frac == nil, tail.int >= 10, tail.int <= 99 {
                    cents += tail.int
                    used.insert(i + 2)
                }
            }
            if cents > 0 { amounts.append(cents) }
        }

        for (i, token) in tokens.enumerated() {
            guard case .cent = token else { continue }
            if let before = numAt(i - 1), before.frac == nil, before.int >= 1, before.int <= 99, !used.contains(i) {
                used.insert(i - 1)
                amounts.append(before.int)
            }
        }

        if !amounts.isEmpty {
            let cents = amounts.reduce(0, +)
            // "Döner 7 Euro und Cola 2,50": a second price without a unit is not in the sum, so the result is a guess.
            let leftover = tokens.indices.contains { i in
                if used.contains(i), true { return false }
                guard let n = tokens[i].number, let f = n.frac else { return false }
                return n.int * 100 + f > 0
            } || !findPairs(tokens, used: used).isEmpty
            return SpokenAmount(cents: cents, certain: amounts.count == 1 && !leftover && cents <= maxCertainCents)
        }
        return findUnitless(tokens)
    }

    /// People say "sieben fünfzig" for 7,50: two number words side by side, the second one 10–99. Returns the first index.
    private static func findPairs(_ tokens: [Token], used: Set<Int>) -> [Int] {
        var found: [Int] = []
        var i = 0
        while i < tokens.count - 1 {
            defer { i += 1 }
            guard let a = tokens[i].number, let b = tokens[i + 1].number, !used.contains(i), !used.contains(i + 1) else { continue }
            guard a.word, b.word, a.frac == nil, b.frac == nil else { continue }
            if a.int >= 1, a.int <= 99, b.int >= 10, b.int <= 99 {
                found.append(i)
                i += 1
            }
        }
        return found
    }

    /// No "Euro" in the sentence: "Kaffee 3,80", "sieben fünfzig", "hab 7 für Döner".
    private static func findUnitless(_ tokens: [Token]) -> SpokenAmount? {
        let nums = tokens.compactMap(\.number)
        let pairs = findPairs(tokens, used: [])
        let decimals = nums.filter { $0.frac != nil && $0.int * 100 + ($0.frac ?? 0) > 0 }
        if let last = decimals.last {
            return SpokenAmount(cents: last.int * 100 + (last.frac ?? 0), certain: decimals.count == 1 && pairs.isEmpty)
        }
        if let p = pairs.last, let a = tokens[p].number, let b = tokens[p + 1].number {
            return SpokenAmount(cents: a.int * 100 + b.int, certain: pairs.count == 1)
        }
        let whole = nums.filter { $0.int > 0 }
        guard let last = whole.last else { return nil }
        // A lone word number may be a count ("zwei Döner"); a lone digit number in a payment sentence is the price.
        return SpokenAmount(cents: last.int * 100, certain: whole.count == 1 && !last.word && last.int * 100 <= maxCertainCents)
    }

    static func parse(_ text: String) -> SpokenAmount? {
        guard let result = findAmount(foldDecimals(tokenize(text))), result.cents > 0 else { return nil }
        return result
    }
}

enum Capture {
    private static let moneyWords: Set<String> = ["euro", "euros", "eur", "cent", "cents", "ct", "komma", "€", "anderthalb"]
    private static let dateWords: Set<String> = ["gestern", "vorgestern"]
    /// Narration around the payment that says nothing about the payee, wherever it stands in the sentence.
    private static let fillerWords: Set<String> = [
        "ich", "hab", "habe", "hab's", "mir", "grad", "grade", "gerade", "eben", "mal", "so", "noch", "halt",
        "gezahlt", "bezahlt", "gekauft", "ausgegeben",
    ]
    /// Articles and prepositions: noise at the edges ("für nen Döner"), but part of a name inside ("Bäckerei am Markt").
    private static let edgeWords: Set<String> = [
        "für", "fürn", "nen", "n", "ein", "eine", "einen", "einem", "einer", "der", "die", "das", "den", "dem",
        "im", "in", "beim", "bei", "am", "an", "zum", "zur", "mit", "vom", "von", "auf",
    ]
    private static let de = Locale(identifier: "de")

    private static func isAmountWord(_ token: String) -> Bool {
        let word = token.lowercased(with: de)
        if word.matches("^€?\\d+(?:[.,]\\d+)*€?$", options: []) || moneyWords.contains(word) { return true }
        if NumberWords.fold(word).hasSuffix("einhalb") { return true }
        return NumberWords.parse(word) != nil
    }

    static func bookingDate(_ text: String, now: Date) -> String {
        let words = Set(text.lowercased(with: de).components(separatedBy: CharacterSet.letters.inverted))
        let today = Day.today(now: now)
        if words.contains("vorgestern") { return Day.addDays(today, -2) }
        if words.contains("gestern") { return Day.addDays(today, -1) }
        return today
    }

    /// The payee: the sentence minus the amount phrase, the day word, narration and edge words. Never empty: a
    /// sentence that is all narration falls back to itself without the amount, then to the original.
    static func counterparty(from text: String) -> String {
        let tokens = text.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        func bare(_ t: String) -> String {
            t.replacingOccurrences(of: "^[^\\p{L}\\p{N}€]+|[^\\p{L}\\p{N}€]+$", with: "", options: .regularExpression)
        }
        func key(_ t: String) -> String { bare(t).lowercased(with: de).replacingOccurrences(of: "’", with: "'") }
        var drop = tokens.map { t -> Bool in
            let word = bare(t)
            return !word.isEmpty && (isAmountWord(word) || dateWords.contains(word.lowercased(with: de)))
        }
        // "sieben und fünfzig Cent": the "und" between two removed words goes with them.
        for i in tokens.indices where i > 0 && i + 1 < tokens.count {
            if bare(tokens[i]).lowercased(with: de) == "und" && drop[i - 1] && drop[i + 1] { drop[i] = true }
        }
        let withoutAmount = tokens.indices.filter { !drop[$0] }.map { tokens[$0] }
        var words = withoutAmount.filter { !fillerWords.contains(key($0)) }
        while let first = words.first, edgeWords.contains(key(first)) { words.removeFirst() }
        while let last = words.last, edgeWords.contains(key(last)) { words.removeLast() }
        var payee = words.joined(separator: " ")
        if payee.isEmpty { payee = withoutAmount.joined(separator: " ") }
        if payee.isEmpty { payee = text.trimmingCharacters(in: .whitespaces) }
        let capitalised = payee.prefix(1).uppercased(with: de) + payee.dropFirst()
        return String(capitalised.prefix(80)).trimmingCharacters(in: .whitespaces)
    }
}
