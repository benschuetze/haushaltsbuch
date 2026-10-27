import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var store: Store
    @Environment(\.dismiss) private var dismiss
    @State private var apiKey = Keychain.read(Assistant.keychainAccount) ?? ""
    @State private var confirmErase = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Card(title: "Assistent") {
                        Text("Eigener Anthropic-API-Schlüssel für „Fragen“. Ohne Schlüssel bleibt der Reiter stumm; alles andere läuft ohne.")
                            .font(.system(size: 14)).foregroundStyle(Theme.muted)
                        SecureField("sk-ant-…", text: $apiKey).font(Theme.number(15)).textContentType(.password)
                            .autocorrectionDisabled().textInputAutocapitalization(.never)
                        Button("Schlüssel speichern") { Keychain.write(Assistant.keychainAccount, apiKey.trimmingCharacters(in: .whitespaces)) }
                            .buttonStyle(InkButtonStyle(primary: true))
                        Text("An das Modell gehen nur deine Frage und Summen, Kategorien und Termine. Nie Empfänger, Verwendungszwecke, Kontonummern oder Rohzeilen.")
                            .font(.system(size: 13)).foregroundStyle(Theme.muted)
                    }
                    Card(title: "Daten") {
                        row("Buchungen", store.ledger.transactions.count)
                        row("Regeln", store.ledger.rules.count)
                        row("Importe", store.ledger.imports.count)
                        Button("Alles löschen", role: .destructive) { confirmErase = true }.buttonStyle(InkButtonStyle())
                    }
                    Card(title: "Datenschutz") {
                        Text("Die Daten liegen als Datei im Container dieser App auf dem iPhone und sind Teil des normalen Geräte-Backups. Es gibt keinen Server, keinen Upload, keine Analyse.")
                            .font(.system(size: 14)).foregroundStyle(Theme.muted)
                    }
                }.padding(16)
            }
            .background(Theme.paper)
            .navigationTitle("Einstellungen")
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Fertig") { dismiss() } } }
            .confirmationDialog("Wirklich alle Buchungen, Regeln und Importe löschen?", isPresented: $confirmErase, titleVisibility: .visible) {
                Button("Alles löschen", role: .destructive) { store.eraseEverything() }
            }
        }
        .foregroundStyle(Theme.ink)
    }

    private func row(_ label: String, _ n: Int) -> some View {
        HStack {
            Text(label).font(.system(size: 15))
            Spacer()
            Text("\(n)").font(Theme.number(15))
        }
    }
}
