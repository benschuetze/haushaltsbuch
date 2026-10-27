import Foundation

// The on-device data model. One JSON file, loaded once, held in memory. Nothing here ever leaves the phone.

enum CategoryKind: String, Codable {
    case expense, income, transfer
}

struct Category: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var kind: CategoryKind

    /// Same list as the web app's seed; the names are what rules, the merchant list and the budget logic key on.
    static let defaults: [Category] = [
        ("Wohnen", CategoryKind.expense), ("Lebensmittel", .expense), ("Kind & Kita", .expense),
        ("Mobilität", .expense), ("Versicherungen", .expense), ("Abos & Verträge", .expense),
        ("Hobbys", .expense), ("Gesundheit", .expense), ("Freizeit", .expense), ("Kleidung", .expense),
        ("Haushalt", .expense), ("Restaurant & Lieferdienst", .expense), ("Haustier", .expense),
        ("Gebühren", .expense), ("Einkommen", .income), ("Umbuchung", .transfer), ("Sonstiges", .expense),
    ].map { Category(id: $0.0, name: $0.0, kind: $0.1) }
}

enum CategorySource: String, Codable {
    case rule, merchant, manual
}

enum TransactionSource: String, Codable {
    case `import`, voice
}

struct Transaction: Codable, Identifiable, Hashable {
    var id: String
    var bookingDate: String
    var amountCents: Int
    var counterparty: String
    var purpose: String
    var accountKey: String
    /// Stable across re-imports of the same file: the same row never lands twice.
    var dedupeHash: String
    var categoryId: String?
    var categorySource: CategorySource?
    var needsReview: Bool
    var source: TransactionSource
    /// What was dictated, kept in full so nothing the user said is lost.
    var captureText: String?
    var createdAt: Date

    var isManual: Bool { categorySource == .manual }
}

enum RuleField: String, Codable {
    case counterparty, purpose
}

enum RuleMatchType: String, Codable {
    case contains, equals
}

struct Rule: Codable, Identifiable, Hashable {
    var id: String
    var field: RuleField
    var matchType: RuleMatchType
    var pattern: String
    var categoryId: String
    var priority: Int
    var createdAt: Date
}

struct Account: Codable, Identifiable, Hashable {
    /// Built-in profile name or "iban:<hash>" for bank exports; "cash" for dictated payments.
    var id: String
    var name: String
}

struct ImportRecord: Codable, Identifiable, Hashable {
    var id: String
    var filename: String
    var importedAt: Date
    var inserted: Int
    var duplicates: Int
    var rejected: Int
}

struct Ledger: Codable {
    var version = 1
    var categories: [Category] = Category.defaults
    var accounts: [Account] = []
    var transactions: [Transaction] = []
    var rules: [Rule] = []
    var imports: [ImportRecord] = []

    func category(_ id: String?) -> Category? {
        guard let id else { return nil }
        return categories.first { $0.id == id }
    }

    func categoryNamed(_ name: String) -> Category? {
        categories.first { $0.name == name }
    }
}
