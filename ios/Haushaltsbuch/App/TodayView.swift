import SwiftUI

/// The question the app answers first: how much can I spend today? One number, and the calculation under it.
struct TodayView: View {
    @EnvironmentObject private var store: Store
    @State private var showCalculation = false
    @State private var showSettings = false

    var body: some View {
        Page(title: "Heute", onSettings: { showSettings = true }) {
            let a = store.available
            if store.ledger.transactions.isEmpty {
                Card {
                    Text("Noch keine Buchungen.").font(Theme.heading(18))
                    Text("Lade unter „Import“ einen Kontoauszug (CSV) hoch oder sprich unter „Erfassen“ eine Ausgabe ein. Alles bleibt auf diesem iPhone.")
                        .font(.system(size: 15)).foregroundStyle(Theme.muted)
                }
            } else {
                Card {
                    PixelLabel(text: "Heute noch ausgeben")
                    Sum(cents: a.perDayCents)
                    Text(subtitle(a)).font(.system(size: 15)).foregroundStyle(Theme.muted)
                    if let missing = a.missingIncome {
                        Text("Das Gehalt vom \(Day.long(missing.date)) ist noch nicht in den Buchungen. Die Zahl ist deshalb vorsichtig: neuen Auszug importieren.")
                            .font(.system(size: 14)).foregroundStyle(Theme.red)
                    }
                    Button(showCalculation ? "Rechnung ausblenden" : "Wie gerechnet?") { withAnimation { showCalculation.toggle() } }
                        .buttonStyle(InkButtonStyle())
                }
                if showCalculation { calculation(a) }
                if store.ledger.reviewCount > 0 {
                    Card {
                        Text(store.ledger.reviewCount == 1 ? "1 Buchung wartet unter „Prüfen“." : "\(store.ledger.reviewCount) Buchungen warten unter „Prüfen“.")
                            .font(.system(size: 15))
                        Text("Unbekannte Empfänger werden nicht geraten. Erst mit Kategorie zählen sie richtig: Einkommen als Gehalt, Sparraten als Umbuchung.")
                            .font(.system(size: 13)).foregroundStyle(Theme.muted)
                    }
                }
            }
        }
        .sheet(isPresented: $showSettings) { SettingsView() }
    }

    private func subtitle(_ a: Available) -> String {
        var parts = ["\(Money.format(a.freeCents)) frei bis \(Day.long(a.periodEnd))", a.daysLeft == 1 ? "1 Tag" : "\(a.daysLeft) Tage"]
        if let next = a.nextIncome { parts.append("Gehalt am \(Day.long(next.date))") }
        return parts.joined(separator: " · ")
    }

    private func calculation(_ a: Available) -> some View {
        Card(title: "Seit \(Day.long(a.periodStart))") {
            VStack(alignment: .leading, spacing: 6) {
                LedgerLine(label: "Eingenommen", cents: a.incomeCents)
                LedgerLine(label: "Ausgegeben", cents: a.spentCents, negative: true)
                if a.savedCents > 0 { LedgerLine(label: "Schon gespart", cents: a.savedCents, negative: true) }
                if !a.upcoming.isEmpty {
                    PixelLabel(text: "Noch fällig bis \(Day.long(a.periodEnd))").padding(.top, 6)
                    ForEach(Array(a.upcoming.enumerated()), id: \.offset) { _, due in
                        LedgerLine(label: "\(due.name) · \(Day.short(due.date))", cents: due.amountCents, negative: true)
                    }
                }
                Divider().overlay(Theme.ink).padding(.vertical, 4)
                LedgerLine(label: "Frei", cents: a.freeCents, negative: a.freeCents < 0)
                LedgerLine(label: "Pro Tag (\(a.daysLeft))", cents: a.perDayCents)
            }
        }
    }
}
