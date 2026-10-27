import CryptoKit
import Foundation

// Everything that changes the ledger, as pure functions on the value type: import a file, book a dictated payment,
// set a category. The store wraps these and saves; the tests call them directly.

struct ImportOutcome {
    var filename: String
    var account: String
    var total: Int
    var inserted: Int
    var duplicates: Int
    var rejected: [RejectedRow]
    var skipped: [RejectedRow]
    var needsReview: Int
}

struct CaptureOutcome {
    var transaction: Transaction
    var categoryName: String?
    /// No usable amount in the sentence: the row only keeps the text so nothing the user said is lost.
    var draft: Bool
}

enum Hashing {
    static func sha256(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

extension Ledger {
    static let cashAccount = Account(id: "cash", name: "Bar")

    /// Transactions as the budget sees them: with category name and kind resolved.
    func bookings() -> [Booking] {
        let byId = Dictionary(uniqueKeysWithValues: categories.map { ($0.id, $0) })
        return transactions.map { t in
            let c = t.categoryId.flatMap { byId[$0] }
            return Booking(bookingDate: t.bookingDate, amountCents: t.amountCents, counterparty: t.counterparty,
                           purpose: t.purpose, categoryName: c?.name, categoryKind: c?.kind)
        }
    }

    func available(today: String) -> Available {
        Budget.available(bookings(), today: today)
    }

    var reviewCount: Int { transactions.filter(\.needsReview).count }

    var months: [String] { Array(Set(transactions.map { Day.month($0.bookingDate) })).sorted(by: >) }

    private mutating func ensureAccount(_ account: Account) {
        if !accounts.contains(where: { $0.id == account.id }) { accounts.append(account) }
    }

    /// The account a file belongs to: its own IBAN, hashed, or one shared "Girokonto" when the export does not say.
    private func accountFor(ownIban: String?) -> Account {
        guard let iban = ownIban else { return Account(id: "giro", name: "Girokonto") }
        return Account(id: "iban:" + String(Hashing.sha256(iban).prefix(16)), name: "Konto …\(iban.suffix(4))")
    }

    /// Two identical card payments on the same day are real and must both survive. Each repeat within a file
    /// gets an occurrence number, so re-importing the same file yields the same hashes and nothing twice.
    static func dedupeHashes(accountId: String, rows: [NormalizedRow]) -> [String] {
        var seen: [String: Int] = [:]
        return rows.map { row in
            let key = [accountId, row.bookingDate, String(row.amountCents), row.counterparty, row.purpose].joined(separator: "\u{1f}")
            let occurrence = (seen[key] ?? 0) + 1
            seen[key] = occurrence
            return Hashing.sha256("\(key)\u{1f}\(occurrence)")
        }
    }

    /// Safety net: rows in = inserted + duplicates + rejected + skipped. No row disappears without a reason.
    mutating func importFile(_ bytes: Data, filename: String, now: Date = Date()) throws -> ImportOutcome {
        let parsed = try Import.read(bytes)
        let account = accountFor(ownIban: parsed.ownIban)
        ensureAccount(account)
        let existing = Set(transactions.map(\.dedupeHash))
        let hashes = Ledger.dedupeHashes(accountId: account.id, rows: parsed.rows)
        var inserted = 0, duplicates = 0, needsReview = 0
        for (row, hash) in zip(parsed.rows, hashes) {
            if existing.contains(hash) { duplicates += 1; continue }
            var tx = Transaction(
                id: UUID().uuidString, bookingDate: row.bookingDate, amountCents: row.amountCents,
                counterparty: row.counterparty, purpose: row.purpose, accountKey: account.id, dedupeHash: hash,
                categoryId: nil, categorySource: nil, needsReview: true, source: .import, captureText: nil, createdAt: now
            )
            Categorize.apply(to: &tx, ledger: self)
            if tx.needsReview { needsReview += 1 }
            transactions.append(tx)
            inserted += 1
        }
        linkOwnTransfers()
        imports.append(ImportRecord(id: UUID().uuidString, filename: filename, importedAt: now, inserted: inserted,
                                    duplicates: duplicates, rejected: parsed.rejected.count))
        return ImportOutcome(filename: filename, account: account.name, total: parsed.rows.count + parsed.rejected.count + parsed.skipped.count,
                             inserted: inserted, duplicates: duplicates, rejected: parsed.rejected, skipped: parsed.skipped,
                             needsReview: needsReview)
    }

    /// Money between own accounts shows up on both sides. With several bank accounts imported, an outgoing amount that
    /// comes in on another account within a few days is a transfer, not spending, on both sides. Dictated cash payments
    /// have no bank counterpart and stay out; a booking the user's own rule has filed is not re-filed either.
    mutating func linkOwnTransfers() {
        let bankAccounts = accounts.filter { $0.id != Ledger.cashAccount.id }
        guard let transfer = categoryNamed("Umbuchung"), bankAccounts.count > 1 else { return }
        let eligible: (Transaction) -> Bool = { !$0.isManual && $0.source != .voice && $0.categorySource != .rule }
        var used = Set<String>()
        for i in transactions.indices where transactions[i].amountCents < 0 && eligible(transactions[i]) {
            let out = transactions[i]
            guard let j = transactions.indices.first(where: { k in
                let t = transactions[k]
                return !used.contains(t.id) && t.accountKey != out.accountKey && t.amountCents == -out.amountCents
                    && eligible(t) && abs(Day.daysBetween(t.bookingDate, out.bookingDate)) <= 5
            }) else { continue }
            used.insert(transactions[j].id)
            for k in [i, j] {
                transactions[k].categoryId = transfer.id
                transactions[k].categorySource = .rule
                transactions[k].needsReview = false
            }
        }
    }

    /// Books one dictated payment. It never refuses a sentence as "not understood": no amount makes a draft, a
    /// doubtful amount or unknown payee goes to "prüfen". The sentence is stored either way.
    mutating func capture(_ text: String, now: Date = Date()) -> CaptureOutcome {
        ensureAccount(Ledger.cashAccount)
        let spoken = SpokenAmountParser.parse(text)
        let amount = spoken.flatMap { $0.cents <= Int(Int32.max) ? $0 : nil }
        // Payments only: a spoken amount is always money going out.
        var tx = Transaction(
            id: UUID().uuidString, bookingDate: Capture.bookingDate(text, now: now), amountCents: -(amount?.cents ?? 0),
            counterparty: Capture.counterparty(from: text), purpose: "", accountKey: Ledger.cashAccount.id,
            dedupeHash: Hashing.sha256("voice\u{1f}\(UUID().uuidString)"), categoryId: nil, categorySource: nil,
            needsReview: true, source: .voice, captureText: text, createdAt: now
        )
        Categorize.apply(to: &tx, ledger: self)
        if !(amount?.certain ?? false) { tx.needsReview = true }
        transactions.append(tx)
        return CaptureOutcome(transaction: tx, categoryName: category(tx.categoryId)?.name, draft: amount == nil)
    }

    /// The user's choice is final for this booking and, unless the counterparty is a payment service,
    /// becomes a rule for every booking of that counterparty, now and in future imports.
    mutating func setCategory(transactionId: String, categoryId: String, now: Date = Date()) {
        guard let i = transactions.firstIndex(where: { $0.id == transactionId }), category(categoryId) != nil else { return }
        transactions[i].categoryId = categoryId
        transactions[i].categorySource = .manual
        transactions[i].needsReview = false
        let counterparty = transactions[i].counterparty.trimmingCharacters(in: .whitespaces)
        guard !counterparty.isEmpty, !Categorize.isAggregator(counterparty) else { return }
        if let r = rules.firstIndex(where: { $0.field == .counterparty && $0.matchType == .equals && $0.pattern.lowercased() == counterparty.lowercased() }) {
            rules[r].categoryId = categoryId
        } else {
            rules.append(Rule(id: UUID().uuidString, field: .counterparty, matchType: .equals, pattern: counterparty,
                              categoryId: categoryId, priority: 0, createdAt: now))
        }
        reapplyRules()
    }

    /// Rules win over the merchant list; manual choices are never touched. Re-filing settles bookings, it never puts
    /// one back on the review list the user has already been through ("Passt so"), and the transfer pairs between
    /// own accounts are linked again afterwards, since re-filing starts every booking from scratch.
    mutating func reapplyRules() {
        for i in transactions.indices where !transactions[i].isManual {
            let reviewed = !transactions[i].needsReview
            Categorize.apply(to: &transactions[i], ledger: self)
            // A dictated amount that was doubtful stays on the review list even when the payee is now known.
            if transactions[i].source == .voice, let text = transactions[i].captureText,
               !(SpokenAmountParser.parse(text)?.certain ?? false) {
                transactions[i].needsReview = true
            }
            if reviewed { transactions[i].needsReview = false }
        }
        linkOwnTransfers()
    }

    mutating func confirm(transactionId: String) {
        guard let i = transactions.firstIndex(where: { $0.id == transactionId }) else { return }
        transactions[i].needsReview = false
    }

    mutating func delete(transactionId: String) {
        transactions.removeAll { $0.id == transactionId }
    }

    mutating func setAmount(transactionId: String, amountCents: Int) {
        guard let i = transactions.firstIndex(where: { $0.id == transactionId }) else { return }
        transactions[i].amountCents = amountCents
    }
}
