import Foundation

// Reads a bank export without knowing the bank: find the header line, map the columns by their names, parse every
// data line. Ported from app/lib/import/formats/generic.ts and profiles/shared.ts. There is no LLM fallback on
// purpose: the file never leaves the phone, so an unknown format is reported with its column names instead.

struct NormalizedRow {
    var line: Int
    var bookingDate: String
    var amountCents: Int
    var currency: String
    var counterparty: String
    var purpose: String
}

struct RejectedRow: Hashable {
    var line: Int
    var reason: String
}

struct ParseResult {
    var rows: [NormalizedRow]
    var rejected: [RejectedRow]
    /// Valid but not booked yet (pending card payments). Not an error, just not now.
    var skipped: [RejectedRow]
    var ownIban: String?
}

struct ColumnMapping {
    var delimiter: Character
    var date: Int
    var amount: Int?
    var debit: Int?
    var credit: Int?
    var decimal: DecimalStyle
    var counterparty: Int?
    var payer: Int?
    var payee: Int?
    var purpose: Int?
    var currency: Int?
    var status: Int?
}

struct Table {
    var delimiter: Character
    var records: [[String]]
    var headerIndex: Int
    var header: [String]
}

enum ImportError: Error, CustomStringConvertible {
    case noTable
    case unknownFormat([String])

    var description: String {
        switch self {
        case .noTable:
            return "Die Datei sieht nicht nach einer Umsatz-Tabelle aus (keine Kopfzeile gefunden)."
        case .unknownFormat(let header):
            return "Das Format dieser Datei kennt die App noch nicht und konnte die Spalten nicht sicher zuordnen. Gefundene Spalten: \(header.joined(separator: ", "))."
        }
    }
}

enum Import {
    private static let delimiters: [Character] = [";", ",", "\t"]

    /// The header is the first line with at least four mostly textual cells whose next non-empty line has the
    /// same width. That skips any preamble (balances, IBAN, period) without knowing the bank.
    private static func findTable(_ records: [[String]]) -> Int {
        for i in 0..<min(records.count, 40) {
            let cells = records[i].map { $0.trimmingCharacters(in: .whitespaces) }
            let filled = cells.filter { !$0.isEmpty }
            let textual = filled.filter { $0.matches("[A-Za-zÄÖÜäöüß]", options: []) && !$0.matches("\\d{2}[./-]\\d{2}", options: []) }
            if filled.count < 4 || Double(textual.count) < Double(filled.count) * 0.8 { continue }
            if let next = records[(i + 1)...].first(where: { $0.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } }),
               abs(next.count - cells.count) <= 1 {
                return i
            }
        }
        return -1
    }

    static func readTable(_ bytes: Data) -> Table? {
        let text = CSV.decode(bytes)
        var best: Table?
        for delimiter in delimiters {
            let records = CSV.parse(text, delimiter: delimiter)
            let headerIndex = findTable(records)
            if headerIndex < 0 { continue }
            let header = records[headerIndex].map { $0.trimmingCharacters(in: .whitespaces) }
            if best == nil || header.count > best!.header.count {
                best = Table(delimiter: delimiter, records: records, headerIndex: headerIndex, header: header)
            }
        }
        return best
    }

    static func dataRows(_ table: Table, limit: Int = 50) -> [[String]] {
        Array(table.records.dropFirst(table.headerIndex + 1)
            .filter { $0.count >= table.header.count && $0.contains { !$0.trimmingCharacters(in: .whitespaces).isEmpty } }
            .prefix(limit))
    }

    private struct ColumnRule {
        enum Field { case date, debit, credit, amount, payee, payer, counterparty, purpose, currency, status }
        var field: Field
        var pattern: String
        var avoid: String? = nil
    }

    // Order matters: the first matching rule claims a column, so specific names come before generic ones.
    private static let rules: [ColumnRule] = [
        .init(field: .date, pattern: "^(buchungstag|buchungsdatum|buchung|booking date|transaction date|datum|date)$"),
        .init(field: .debit, pattern: "^soll\\b|^debit|^ausgang"),
        .init(field: .credit, pattern: "^haben\\b|^credit|^eingang"),
        .init(field: .amount, pattern: "^(betrag|umsatz|amount)(\\s*\\(.*\\)|\\s+in\\s+\\w+)?$", avoid: "saldo|ursprung|fremd|gebühr|balance"),
        .init(field: .payee, pattern: "zahlungsempfänger|^empfänger$|^payee"),
        .init(field: .payer, pattern: "zahlungspflichtige|^auftraggeber$|^payer"),
        .init(field: .counterparty, pattern: "empfänger|auftraggeber|begünstigter|zahlungsbeteiligter|partner name|^name|counterparty|gegenkonto.*name", avoid: "iban|bic|konto|abweichend"),
        .init(field: .purpose, pattern: "^verwendungszweck$|^zweck$|payment reference|^reference$|^beschreibung$|^description$"),
        .init(field: .purpose, pattern: "^buchungstext$"),
        .init(field: .purpose, pattern: "^vorgang$|^text$|^umsatzart$|^memo$"),
        .init(field: .currency, pattern: "^(währung|waehrung|currency)$"),
        .init(field: .status, pattern: "^(status|info)$"),
    ]

    /// Free, local guess of the column mapping from header names alone. Returns nil rather than a shaky guess.
    static func guessMapping(_ table: Table) -> ColumnMapping? {
        var found: [ColumnRule.Field: Int] = [:]
        var taken = Set<Int>()
        for rule in rules {
            if found[rule.field] != nil { continue }
            if let idx = table.header.indices.first(where: { i in
                !taken.contains(i) && table.header[i].matches(rule.pattern) && !(rule.avoid.map { table.header[i].matches($0) } ?? false)
            }) {
                found[rule.field] = idx
                taken.insert(idx)
            }
        }
        // Payer and payee only make sense as a pair; a lone match is the counterparty.
        if (found[.payer] == nil) != (found[.payee] == nil) {
            if found[.counterparty] == nil { found[.counterparty] = found[.payer] ?? found[.payee] }
            found[.payer] = nil
            found[.payee] = nil
        }
        if found[.amount] != nil {
            found[.debit] = nil
            found[.credit] = nil
        }
        guard let date = found[.date] else { return nil }
        guard found[.amount] != nil || (found[.debit] != nil && found[.credit] != nil) else { return nil }
        guard found[.purpose] != nil || found[.counterparty] != nil || found[.payee] != nil else { return nil }
        let amountColumns = [found[.amount], found[.debit], found[.credit]].compactMap { $0 }
        let samples = dataRows(table).flatMap { row in amountColumns.map { row.indices.contains($0) ? row[$0] : "" } }
        guard let decimal = Money.detectDecimalStyle(samples) else { return nil }
        return ColumnMapping(
            delimiter: table.delimiter, date: date, amount: found[.amount], debit: found[.debit], credit: found[.credit],
            decimal: decimal, counterparty: found[.counterparty], payer: found[.payer], payee: found[.payee],
            purpose: found[.purpose], currency: found[.currency], status: found[.status]
        )
    }

    private static let pending = "vorgemerkt|pending|reserviert|nicht gebucht"
    private static let dateLike = "\\d{1,4}[./-]\\d{1,2}[./-]\\d{2,4}"
    private static let iban = "\\b([A-Z]{2}\\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?)\\b"
    private static let ownAccountColumn = "^(auftragskonto|iban auftragskonto|eigene iban|account iban|kontonummer auftragskonto)$"

    /// The own IBAN sits either in the preamble (ING, DKB) or in a column that repeats it on every row (Sparkasse, VR).
    static func findOwnIban(_ records: [[String]], headerIndex: Int) -> String? {
        for cell in records.prefix(headerIndex).joined() {
            if let m = cell.trimmingCharacters(in: .whitespaces).firstMatch(iban) {
                return m[1].replacingOccurrences(of: " ", with: "")
            }
        }
        let header = headerIndex < records.count ? records[headerIndex] : []
        guard let col = header.firstIndex(where: { $0.trimmingCharacters(in: .whitespaces).matches(ownAccountColumn) }) else { return nil }
        let values = Set(records.dropFirst(headerIndex + 1).map { $0.indices.contains(col) ? $0[col].trimmingCharacters(in: .whitespaces) : "" }.filter { !$0.isEmpty })
        guard values.count == 1, let only = values.first, only.matches(iban, options: []) else { return nil }
        return only.replacingOccurrences(of: " ", with: "")
    }

    private struct SkipRow: Error { var reason: String }

    /// Some banks (comdirect) pack the other party into the text: "Auftraggeber: X Buchungstext: Y Ref. …".
    static func splitCombinedText(_ text: String) -> (counterparty: String, purpose: String) {
        if let m = text.firstMatch("(?:Auftraggeber|Empfänger|Zahlungsempfänger|Begünstigter|Zahlungspflichtiger)\\s*:\\s*(.+?)\\s+(?:Buchungstext|Verwendungszweck)\\s*:\\s*(.*)$", options: [.caseInsensitive]), !m[1].isEmpty {
            let counterparty = m[1].replacingOccurrences(of: "\\s+(?:Kto/IBAN|IBAN|BLZ/BIC|BIC)\\s*:.*$", with: "", options: [.regularExpression, .caseInsensitive]).trimmingCharacters(in: .whitespaces)
            let purpose = m[2].replacingOccurrences(of: "\\s+Ref\\.\\s+\\S+\\s*$", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
            return (counterparty, purpose)
        }
        return (String(text.prefix(60)).trimmingCharacters(in: .whitespaces), text)
    }

    /// Walks the data lines below the header. Every line ends up as a row, a rejection with line number and reason,
    /// or a skip (pending booking, balance footer). Nothing is dropped silently except completely empty lines.
    static func parse(_ table: Table, mapping: ColumnMapping) -> ParseResult {
        var rows: [NormalizedRow] = []
        var rejected: [RejectedRow] = []
        var skipped: [RejectedRow] = []
        let header = table.header
        func at(_ fields: [String], _ idx: Int?) -> String {
            guard let idx, fields.indices.contains(idx) else { return "" }
            return fields[idx].trimmingCharacters(in: .whitespaces)
        }
        for (i, fields) in table.records.dropFirst(table.headerIndex + 1).enumerated() {
            let line = table.headerIndex + i + 2
            if fields.allSatisfy({ $0.trimmingCharacters(in: .whitespaces).isEmpty }) { continue }
            // A trailing delimiter (comdirect) yields one extra empty field; that is not a broken line.
            var effective = fields
            if fields.count == header.count + 1, fields.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
                effective = Array(fields.dropLast())
            }
            if effective.count != header.count {
                let first = effective.first { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? ""
                if !first.matches(dateLike, options: []) {
                    skipped.append(RejectedRow(line: line, reason: "keine Buchung (z. B. Kontostand unter der Tabelle)"))
                } else {
                    rejected.append(RejectedRow(line: line, reason: "\(effective.count) statt \(header.count) Spalten"))
                }
                continue
            }
            do {
                if let status = mapping.status, at(effective, status).matches(pending) {
                    throw SkipRow(reason: "vorgemerkt, noch nicht gebucht – kommt mit dem nächsten Export")
                }
                let amountCents: Int
                if let amount = mapping.amount {
                    amountCents = try Money.parseAmount(at(effective, amount), style: mapping.decimal)
                } else {
                    // Soll is often given without a minus sign; a debit always reduces the balance.
                    let debit = at(effective, mapping.debit)
                    let credit = at(effective, mapping.credit)
                    amountCents = debit.isEmpty ? try Money.parseAmount(credit, style: mapping.decimal) : -abs(try Money.parseAmount(debit, style: mapping.decimal))
                }
                let purpose = at(effective, mapping.purpose)
                var counterparty: String
                if let payer = mapping.payer, let payee = mapping.payee {
                    counterparty = at(effective, amountCents < 0 ? payee : payer)
                } else {
                    counterparty = at(effective, mapping.counterparty)
                }
                var cleanPurpose = purpose
                if counterparty.isEmpty {
                    let split = splitCombinedText(purpose)
                    counterparty = split.counterparty
                    cleanPurpose = split.purpose
                }
                let currency = at(effective, mapping.currency)
                rows.append(NormalizedRow(
                    line: line,
                    bookingDate: try Money.parseDate(at(effective, mapping.date)),
                    amountCents: amountCents,
                    currency: currency.isEmpty ? "EUR" : currency,
                    counterparty: counterparty,
                    purpose: cleanPurpose
                ))
            } catch let skip as SkipRow {
                skipped.append(RejectedRow(line: line, reason: skip.reason))
            } catch {
                rejected.append(RejectedRow(line: line, reason: String(describing: error)))
            }
        }
        return ParseResult(rows: rows, rejected: rejected, skipped: skipped, ownIban: findOwnIban(table.records, headerIndex: table.headerIndex))
    }

    /// A mapping is only trusted if it reads the actual file: most data lines must parse, at least one must.
    static func mappingWorks(_ table: Table, _ mapping: ColumnMapping) -> Bool {
        let r = parse(table, mapping: mapping)
        return r.rows.count > 0 && Double(r.rows.count) >= Double(r.rows.count + r.rejected.count) * 0.8
    }

    /// The whole file in one go, or a readable error.
    static func read(_ bytes: Data) throws -> ParseResult {
        guard let table = readTable(bytes) else { throw ImportError.noTable }
        guard let mapping = guessMapping(table), mappingWorks(table, mapping) else { throw ImportError.unknownFormat(table.header) }
        return parse(table, mapping: mapping)
    }
}
