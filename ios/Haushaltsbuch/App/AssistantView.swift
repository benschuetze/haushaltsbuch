import SwiftUI

/// "Kann ich mir 80 € fürs Feiern leisten?" Claude answers with numbers from the local tools; the chat lives only
/// in memory for this session.
struct AssistantView: View {
    @EnvironmentObject private var store: Store
    @State private var messages: [Assistant.Message] = []
    @State private var question = ""
    @State private var busy = false
    @State private var problem: String?
    @FocusState private var focused: Bool

    private let suggestions = ["Wie viel kann ich heute ausgeben?", "Kann ich mir 80 € fürs Feiern leisten?", "Wann kommt mein Gehalt?", "Was geht diese Woche noch ab?"]

    var body: some View {
        Page(title: "Fragen") {
            if messages.isEmpty {
                Card {
                    Text("Frag mit echten Zahlen aus deinen Buchungen. An das Modell gehen nur Summen, Kategorien und Termine.")
                        .font(.system(size: 14)).foregroundStyle(Theme.muted)
                    ForEach(suggestions, id: \.self) { s in
                        Button(s) { question = s; send() }.buttonStyle(InkButtonStyle())
                    }
                }
            }
            ForEach(messages) { m in
                Card(title: m.role == "user" ? "Du" : "Assistent") {
                    Text(m.text).font(.system(size: 15)).textSelection(.enabled)
                }
            }
            if busy { Text("Rechnet …").font(.system(size: 14)).foregroundStyle(Theme.muted) }
            if let problem { Text(problem).font(.system(size: 14)).foregroundStyle(Theme.red) }
            Card {
                TextField("Frage", text: $question, axis: .vertical).lineLimit(1...3).font(.system(size: 17)).focused($focused).onSubmit(send)
                HStack(spacing: 10) {
                    if !messages.isEmpty { Button("Neu") { messages = []; problem = nil }.buttonStyle(InkButtonStyle()) }
                    Button("Fragen", action: send).buttonStyle(InkButtonStyle(primary: true))
                        .disabled(busy || question.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func send() {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        question = ""
        problem = nil
        focused = false
        messages.append(Assistant.Message(role: "user", text: q))
        busy = true
        let history = messages
        let ledger = store.ledger
        Task { @MainActor in
            defer { busy = false }
            do {
                let answer = try await Assistant.ask(history: history, ledger: ledger)
                messages.append(Assistant.Message(role: "assistant", text: answer))
            } catch {
                problem = String(describing: error)
                messages.removeLast()
            }
        }
    }
}
