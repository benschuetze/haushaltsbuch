import Foundation

/// The assistant of the web app, moved onto the phone: Claude answers over read-only tools, and every number in the
/// answer comes from a tool. What leaves the device is the question and the tool results, and those carry sums,
/// category names, dates and verdicts only. Counterparties, purposes, account numbers and raw rows never go out,
/// not even for recurring payments (those are named by category, "Abos & Verträge 13,99 € am 12.10.").
enum Assistant {
    static let keychainAccount = "anthropic-api-key"
    /// Same cheap model the web app uses; answers are short and every number comes from a tool.
    static let model = "claude-haiku-5-5"
    static let maxHistory = 10

    struct Message: Codable, Identifiable, Equatable {
        var id = UUID()
        var role: String
        var text: String
    }

    static let system = """
    Du bist der Assistent im Haushaltsbuch einer Privatperson in Deutschland.
    - Antworte auf Deutsch, kurz und direkt wie ein guter Freund mit Ahnung von Geld: erst die Antwort mit Zahl, dann höchstens ein Satz Begründung. Beträge mit Euro-Zeichen. Datumsangaben als „1. November“.
    - „Wie viel kann ich (heute) ausgeben?“: heute_verfuegbar; den Tagesbetrag nennst du „Tagesbudget“. „Kann ich mir X leisten?“: leisten mit dem Betrag. „Wann kommt das Gehalt / was geht noch ab?“: naechste_zahlungen. Fragen zu einem Monat: monatsuebersicht. Abos und Fixkosten: abos_und_fixkosten.
    - Wenn gehaltNochNichtGebucht gesetzt ist, sag kurz dazu, dass das Gehalt noch nicht in den Buchungen ist und die Zahl deshalb vorsichtig ist.
    - Bei leisten: locker = klares Ja; geht = Ja, mit dem Betrag pro Tag danach; knapp = ehrlich sagen, dass es eng wird; nein = Nein, mit dem fehlenden Betrag. Nie moralisieren.
    - Antworte knapp: höchstens 120 Wörter. Nenne Beträge exakt so, wie die Werkzeuge sie liefern. Erfinde nie Buchungen, Beträge oder Abos.
    - Die Werkzeuge nennen aus Datenschutzgründen keine Empfänger, nur Kategorien. Frag nicht nach Namen.
    """

    private static func euro(_ cents: Int) -> String { Money.format(cents) }
    /// JSONSerialization refuses Swift optionals; a missing value is an explicit null.
    private static func orNull(_ value: Any?) -> Any { value ?? NSNull() }
    private static let noInput: [String: Any] = ["type": "object", "properties": [String: Any](), "additionalProperties": false]

    /// Tool definitions as the API expects them (raw JSON schema). Names match the web app.
    static let tools: [[String: Any]] = [
        ["name": "heute_verfuegbar", "description": "Wie viel Geld heute frei ist und bis zum nächsten Gehalt: Einnahmen seit dem letzten Gehalt minus Ausgaben minus noch fällige Fixkosten, Abos und Sparrate, verteilt auf die restlichen Tage.", "input_schema": noInput],
        ["name": "leisten", "description": "Prüft, ob eine Ausgabe gerade drin ist. Urteil: locker, geht, knapp, nein.", "input_schema": ["type": "object", "properties": ["betragEuro": ["type": "number", "description": "Betrag ohne Vorzeichen"], "wofuer": ["type": "string"]], "required": ["betragEuro"], "additionalProperties": false]],
        ["name": "naechste_zahlungen", "description": "Nächstes Gehalt und was bis dahin noch abgeht (Fixkosten, Abos, Sparrate), nach Kategorie.", "input_schema": noInput],
        ["name": "monatsuebersicht", "description": "Einnahmen, Ausgaben und Summen je Kategorie für einen Monat (JJJJ-MM). Ohne Monat: der aktuelle.", "input_schema": ["type": "object", "properties": ["monat": ["type": "string", "description": "JJJJ-MM"]], "additionalProperties": false]],
        ["name": "abos_und_fixkosten", "description": "Erkannte wiederkehrende Zahlungen nach Kategorie: Rhythmus, letzter Betrag, Jahreskosten, Preisänderung.", "input_schema": noInput],
    ]

    /// Runs one tool over the ledger. Only aggregates go back.
    static func run(tool: String, input: [String: Any], ledger: Ledger, today: String) -> [String: Any] {
        let a = ledger.available(today: today)
        let dues: ([Due]) -> [[String: Any]] = { $0.map { ["was": categoryLabel(for: $0.name, ledger: ledger), "am": $0.date, "betrag": euro($0.amountCents)] } }
        switch tool {
        case "heute_verfuegbar":
            return [
                "heute": a.today, "tagesbudget": euro(a.perDayCents), "freiBisGehalt": euro(a.freeCents), "tageBisGehalt": a.daysLeft,
                "naechstesGehalt": orNull(a.nextIncome.map { ["am": $0.date, "betrag": euro($0.amountCents)] as [String: Any] }),
                "seitLetztemGehalt": ["eingenommen": euro(a.incomeCents), "ausgegeben": euro(a.spentCents)],
                "gehaltNochNichtGebucht": orNull(a.missingIncome.map { ["erwartetAm": $0.date] as [String: Any] }),
                "nochFaellig": dues(a.upcoming),
            ]
        case "leisten":
            let betrag = (input["betragEuro"] as? Double) ?? 0
            let r = Budget.canAfford(a, amountCents: Int((betrag * 100).rounded()))
            return [
                "urteil": r.verdict.rawValue, "wofuer": orNull(input["wofuer"] as? String), "betrag": euro(r.amountCents),
                "tagesbudgetVorher": euro(a.perDayCents), "freiBisGehaltDanach": euro(r.afterCents), "proTagDanach": euro(r.perDayAfterCents),
                "tageBisGehalt": a.daysLeft, "naechstesGehaltAm": orNull(a.nextIncome?.date),
            ]
        case "naechste_zahlungen":
            return ["heute": a.today, "naechstesGehalt": orNull(a.nextIncome.map { ["am": $0.date, "betrag": euro($0.amountCents)] as [String: Any] }), "abgaenge": dues(a.upcoming)]
        case "monatsuebersicht":
            let month = (input["monat"] as? String).flatMap { $0.matches("^\\d{4}-\\d{2}$", options: []) ? $0 : nil } ?? Day.month(today)
            let s = Budget.monthSummary(ledger.bookings(), month: month)
            return [
                "monat": month, "einnahmen": euro(s.incomeCents), "ausgaben": euro(s.expenseCents), "umbuchungen": euro(s.transferCents),
                "vorhandeneMonate": ledger.months,
                "kategorien": s.byCategory.map { ["kategorie": $0.name, "summe": euro($0.cents), "buchungen": $0.count] },
            ]
        case "abos_und_fixkosten":
            let all = Budget.detectRecurring(ledger.bookings(), referenceDate: today)
            return ["zahlungen": all.map { r in
                [
                    "kategorie": r.categoryName ?? "ohne Kategorie", "art": r.active ? (r.isFixed ? "Fixkosten" : "Abo") : "beendet",
                    "rhythmus": r.cadence.rawValue, "letzterBetrag": euro(r.lastAmountCents),
                    "vorherigerBetrag": orNull(r.previousAmountCents.map(euro)), "proJahr": euro(r.yearlyCents), "zuletzt": r.lastDate, "anzahl": r.occurrences,
                ]
            }]
        default:
            return ["fehler": "Unbekanntes Werkzeug"]
        }
    }

    /// A due item is named after its merchant on the device; towards the model it is its category.
    private static func categoryLabel(for merchant: String, ledger: Ledger) -> String {
        let key = Merchants.key(merchant)
        let hit = ledger.transactions.last { Merchants.key(Merchants.merchantOf(counterparty: $0.counterparty, purpose: $0.purpose)) == key }
        return ledger.category(hit?.categoryId)?.name ?? "Fixkosten"
    }

    enum Failure: Error, CustomStringConvertible {
        case noKey, http(Int, String), malformed, refused

        var description: String {
            switch self {
            case .noKey: return "Kein API-Schlüssel. Unter Heute › Einstellungen eintragen."
            case .http(let code, let text): return "Anfrage fehlgeschlagen (\(code)): \(text)"
            case .malformed: return "Die Antwort ließ sich nicht lesen."
            case .refused: return "Das Modell hat die Frage abgelehnt."
            }
        }
    }

    /// POST /v1/messages with the tool loop: run tools locally, hand back results, until the model answers in text.
    static func ask(history: [Message], ledger: Ledger, today: String = Day.today()) async throws -> String {
        guard let key = Keychain.read(keychainAccount), !key.isEmpty else { throw Failure.noKey }
        // The API insists on a user turn first; after an even cut the window could start with an answer.
        var recent = Array(history.suffix(maxHistory))
        if let firstUser = recent.firstIndex(where: { $0.role == "user" }) { recent.removeFirst(firstUser) }
        var messages: [[String: Any]] = recent.map { ["role": $0.role, "content": $0.text] }
        for _ in 0..<6 {
            let body: [String: Any] = ["model": model, "max_tokens": 2048, "system": system, "tools": tools, "messages": messages]
            var request = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.setValue(key, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.timeoutInterval = 60
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.malformed }
            guard status == 200 else {
                let error = (json["error"] as? [String: Any])?["message"] as? String ?? String(decoding: data, as: UTF8.self)
                throw Failure.http(status, error)
            }
            guard let content = json["content"] as? [[String: Any]] else { throw Failure.malformed }
            let stop = json["stop_reason"] as? String
            if stop == "refusal" { throw Failure.refused }
            if stop != "tool_use" {
                let text = content.compactMap { $0["type"] as? String == "text" ? $0["text"] as? String : nil }.joined(separator: "\n")
                return text.isEmpty ? "Dazu habe ich keine Antwort." : text
            }
            // Hand every tool result back in one user message, in the order the calls came.
            messages.append(["role": "assistant", "content": content])
            let results: [[String: Any]] = content.compactMap { block in
                guard block["type"] as? String == "tool_use", let id = block["id"] as? String, let name = block["name"] as? String else { return nil }
                let input = block["input"] as? [String: Any] ?? [:]
                let result = run(tool: name, input: input, ledger: ledger, today: today)
                let text = (try? JSONSerialization.data(withJSONObject: result)).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
                return ["type": "tool_result", "tool_use_id": id, "content": text]
            }
            messages.append(["role": "user", "content": results])
        }
        return "Das wurde zu lang; frag bitte etwas einfacher."
    }
}
