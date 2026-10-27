import Foundation

// Categorisation without a model: the user's own rules first, then merchants everyone in Germany knows. Anything
// else stays uncategorised and marked "prüfen"; nothing is guessed. Ported from rules.ts and known-merchants.ts.

enum Categorize {
    /// Built-in rules for well-known merchants. Matched on the counterparty only; a purpose like
    /// "PayPal ... Lieferando" on the current account is a transfer, not a meal.
    /// Order matters where names overlap: "Uber Eats" is food delivery before "Uber" is a ride.
    static let knownMerchants: [(category: String, pattern: String)] = [
        ("Restaurant & Lieferdienst", "\\b(lieferando|wolt|uber\\s*eats|deliveroo|mcdonald'?s|burger king|starbucks|subway|vapiano|domino'?s|kfc)\\b"),
        ("Lebensmittel", "\\b(rewe|edeka|aldi|lidl|netto|penny|kaufland|tegut|globus|norma|denns|alnatura|bäckerei|baeckerei)\\b"),
        ("Abos & Verträge", "\\b(netflix|disney\\s*(plus|\\+)?|spotify|amazon prime|prime video|audible|dazn|sky deutschland|rtl\\+|joyn|deezer|tidal|youtube premium|apple\\.com|itunes|icloud|microsoft|adobe|dropbox|openai|chatgpt|anthropic|playstation|xbox|telekom|vodafone|o2|telef[oó]nica|1\\s*&\\s*1|1und1|congstar|fitx|mcfit|urban sports)\\b"),
        ("Mobilität", "\\b(aral|shell|esso|jet tankstelle|totalenergies|db vertrieb|deutsche bahn|bvg|mvg|hvv|flixbus|uber|free now|tier mobility|lime)\\b"),
        ("Haushalt", "\\b(dm-drogerie|dm drogerie|rossmann|müller drogerie|ikea|obi|bauhaus|hornbach|toom)\\b"),
        ("Kleidung", "\\b(zalando|h\\s*&\\s*m|zara|c\\s*&\\s*a|primark|about you|deichmann)\\b"),
        ("Gesundheit", "\\b(apotheke|docmorris|shop apotheke)\\b"),
        ("Freizeit", "\\b(cinemaxx|kino|zoo|eventim)\\b"),
        ("Haustier", "\\b(fressnapf|zooplus)\\b"),
        ("Wohnen", "\\b(stadtwerke|hausverwaltung|vattenfall|e\\.on|enbw)\\b"),
        ("Versicherungen", "versicherung|\\b(allianz|huk-coburg|ergo|axa|debeka)\\b"),
        ("Gebühren", "\\b(rundfunk|ard zdf)\\b"),
    ]

    /// Money moved to own savings, in either direction. The web app leaves this to the model; on the phone there is
    /// none, and a savings transfer filed as spending would distort the daily budget until corrected.
    static let ownTransfer = "\\b(tagesgeld|sparkonto|sparbuch|festgeld|depot|extra-?konto|sparplan|sparrate|umbuchung|übertrag|uebertrag|eigenes konto|eigene[sn]? konto)\\b"
    /// Regular income by its wording. Only for money coming in: "Gehalt" in an outgoing purpose is someone else's.
    static let income = "\\b(gehalt|lohn|bezuege|bezüge|besoldung|rente|pension|kindergeld|elterngeld|wohngeld|bafög|bafoeg|arbeitslosengeld|bürgergeld|buergergeld|krankengeld)\\b"

    /// Merchant rules apply to money going out (a pension paid by "Deutsche Rentenversicherung" is income, not
    /// insurance); the transfer and income wordings are the two exceptions, checked on counterparty and purpose.
    static func knownMerchantCategory(counterparty: String, purpose: String, amountCents: Int) -> String? {
        let text = "\(counterparty) \(purpose)"
        if text.matches(ownTransfer) { return "Umbuchung" }
        if amountCents >= 0 { return text.matches(income) ? "Einkommen" : nil }
        return knownMerchants.first { counterparty.matches($0.pattern) }?.category
    }

    static func ruleMatches(_ rule: Rule, counterparty: String, purpose: String) -> Bool {
        let value = (rule.field == .counterparty ? counterparty : purpose).lowercased(with: Locale(identifier: "de"))
        let pattern = rule.pattern.lowercased(with: Locale(identifier: "de"))
        switch rule.matchType {
        case .equals: return value.trimmingCharacters(in: .whitespaces) == pattern.trimmingCharacters(in: .whitespaces)
        case .contains: return value.contains(pattern)
        }
    }

    /// Highest priority wins; on a tie the older rule wins so adding a rule never silently reshuffles existing ones.
    static func firstMatchingRule(_ rules: [Rule], counterparty: String, purpose: String) -> Rule? {
        rules.sorted { a, b in a.priority != b.priority ? a.priority > b.priority : a.createdAt < b.createdAt }
            .first { ruleMatches($0, counterparty: counterparty, purpose: purpose) }
    }

    /// Payment services bundle many shops; the shop is in the purpose ("PP.4471.PP . Thomann GmbH, Ihr Einkauf …").
    static let aggregator = "paypal|klarna|amazon payments|sumup|stripe|adyen"

    static func isAggregator(_ counterparty: String) -> Bool {
        counterparty.matches(aggregator)
    }

    /// Fills category, source and review flag for one booking. A manual choice is never touched.
    static func apply(to tx: inout Transaction, ledger: Ledger) {
        if tx.isManual { return }
        if let rule = firstMatchingRule(ledger.rules, counterparty: tx.counterparty, purpose: tx.purpose),
           ledger.category(rule.categoryId) != nil {
            tx.categoryId = rule.categoryId
            tx.categorySource = .rule
            tx.needsReview = false
            return
        }
        if let name = knownMerchantCategory(counterparty: tx.counterparty, purpose: tx.purpose, amountCents: tx.amountCents),
           let category = ledger.categoryNamed(name) {
            tx.categoryId = category.id
            tx.categorySource = .merchant
            tx.needsReview = false
            return
        }
        tx.categoryId = nil
        tx.categorySource = nil
        tx.needsReview = true
    }
}
