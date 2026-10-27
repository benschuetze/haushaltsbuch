import SwiftUI
import UniformTypeIdentifiers

/// Pick a bank export from Files (or share it into the app). Parsed and filed on the phone; the file is never uploaded.
struct ImportView: View {
    @EnvironmentObject private var store: Store
    @State private var picking = false
    @State private var outcomes: [ImportOutcome] = []
    @State private var problem: String?

    var body: some View {
        Page(title: "Import") {
            Card {
                Text("Kontoauszug (CSV) deiner Bank auswählen, gern mehrere. Bank und Spalten erkennt die App an der Kopfzeile. Dieselbe Datei zweimal: nichts doppelt.")
                    .font(.system(size: 15)).foregroundStyle(Theme.muted)
                Button("Datei wählen") { picking = true }.buttonStyle(InkButtonStyle(primary: true))
            }
            if let problem {
                Card(title: "Nicht importiert") { Text(problem).font(.system(size: 14)).foregroundStyle(Theme.red) }
            }
            ForEach(Array(outcomes.enumerated()), id: \.offset) { _, o in result(o) }
            if !store.ledger.imports.isEmpty {
                Card(title: "Bisher") {
                    ForEach(store.ledger.imports.suffix(8).reversed()) { r in
                        HStack {
                            Text(r.filename).lineLimit(1).font(.system(size: 14))
                            Spacer()
                            Text("\(r.inserted) neu").font(Theme.number(14)).foregroundStyle(Theme.muted)
                        }
                    }
                }
            }
            Card(title: "Datenschutz") {
                Text("Alles bleibt auf diesem iPhone: Datei, Buchungen, Regeln. Es gibt keinen Server und keinen Upload.")
                    .font(.system(size: 14)).foregroundStyle(Theme.muted)
            }
        }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.commaSeparatedText, .plainText, .text, .data], allowsMultipleSelection: true) { result in
            problem = nil
            switch result {
            case .failure(let error):
                problem = error.localizedDescription
            case .success(let urls):
                // One after another: a rule learned from file 1 already applies to file 2.
                for url in urls {
                    if let o = store.importFile(url) { outcomes.insert(o, at: 0) }
                    else if let e = store.lastError { problem = "\(url.lastPathComponent): \(e)" }
                }
            }
        }
    }

    private func result(_ o: ImportOutcome) -> some View {
        Card(title: o.filename) {
            VStack(alignment: .leading, spacing: 6) {
                row("Zeilen", o.total)
                row("Neu", o.inserted)
                row("Duplikate", o.duplicates)
                if !o.skipped.isEmpty { row("Vorgemerkt / keine Buchung", o.skipped.count) }
                if !o.rejected.isEmpty { row("Abgelehnt", o.rejected.count) }
                row("Zu prüfen", o.needsReview)
            }
            Text("Konto: \(o.account)").font(.system(size: 13)).foregroundStyle(Theme.muted)
            ForEach(o.rejected.prefix(5), id: \.self) { r in
                Text("Zeile \(r.line): \(r.reason)").font(.system(size: 13)).foregroundStyle(Theme.red)
            }
        }
    }

    private func row(_ label: String, _ n: Int) -> some View {
        HStack {
            Text(label).font(.system(size: 15))
            Spacer()
            Text("\(n)").font(Theme.number(15))
        }
    }
}
