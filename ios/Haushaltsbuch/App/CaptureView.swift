import SwiftUI

/// Say or type one sentence ("7 Euro Döner"), tap "Buchen". Only the amount is needed; the day defaults to today
/// ("gestern" moves it), the account is always "Bar". Nothing is asked back: a doubtful reading goes to "Prüfen".
struct CaptureView: View {
    @EnvironmentObject private var store: Store
    @StateObject private var speech = SpeechRecognizer()
    @State private var text = ""
    @State private var last: CaptureOutcome?
    @FocusState private var focused: Bool

    var body: some View {
        Page(title: "Erfassen") {
            Card {
                PixelLabel(text: "Was hast du bezahlt?")
                TextField("z. B. 7 Euro Döner, gestern 12,30 bei Rewe", text: $text, axis: .vertical)
                    .lineLimit(2...4)
                    .font(.system(size: 17))
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(book)
                HStack(spacing: 10) {
                    Button {
                        focused = false
                        speech.toggle()
                    } label: {
                        Label(speech.listening ? "Stopp" : "Sprechen", systemImage: speech.listening ? "stop.circle" : "mic")
                    }
                    .buttonStyle(InkButtonStyle())
                    Button("Buchen", action: book)
                        .buttonStyle(InkButtonStyle(primary: true))
                        // Dictation delivers late results after "Buchen"; booking while it listens made double bookings.
                        .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty || speech.listening)
                }
                if speech.listening {
                    Text(speech.transcript.isEmpty ? "Ich höre zu …" : speech.transcript).font(.system(size: 15)).foregroundStyle(Theme.muted)
                }
                if let problem = speech.problem {
                    Text(problem).font(.system(size: 14)).foregroundStyle(Theme.red)
                }
            }
            if let last { result(last) }
            Card(title: "Hinweis") {
                Text("Die Spracherkennung läuft auf dem iPhone, der Satz verlässt das Gerät nicht. Nur der Betrag ist Pflicht: „sieben fünfzig Bäcker“ reicht.")
                    .font(.system(size: 14)).foregroundStyle(Theme.muted)
            }
        }
        .onChange(of: speech.listening) { _, listening in
            if !listening, !speech.transcript.isEmpty { text = speech.transcript }
        }
    }

    private func book() {
        let sentence = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !sentence.isEmpty, !speech.listening else { return }
        last = store.capture(sentence)
        text = ""
        speech.transcript = ""
        focused = false
    }

    private func result(_ outcome: CaptureOutcome) -> some View {
        let tx = outcome.transaction
        return Card(title: outcome.draft ? "Entwurf, ohne Betrag" : "Gebucht") {
            HStack(alignment: .firstTextBaseline) {
                Text(tx.counterparty).font(Theme.heading(20))
                Spacer()
                Amount(cents: tx.amountCents, size: 20)
            }
            Text([Day.short(tx.bookingDate), "Bar", outcome.categoryName ?? "ohne Kategorie"].joined(separator: " · "))
                .font(.system(size: 14)).foregroundStyle(Theme.muted)
            if outcome.draft {
                Text("Keinen Betrag verstanden. Der Satz ist gespeichert; Betrag unter „Prüfen“ nachtragen.").font(.system(size: 14)).foregroundStyle(Theme.red)
            } else if tx.needsReview {
                Text("Liegt unter „Prüfen“: Kategorie oder Betrag bitte kurz bestätigen.").font(.system(size: 14)).foregroundStyle(Theme.muted)
            }
            Button("Rückgängig") {
                store.delete(tx.id)
                last = nil
            }.buttonStyle(InkButtonStyle())
        }
    }
}
