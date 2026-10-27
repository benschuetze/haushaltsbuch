import SwiftUI

/// Everything the app did not want to guess: unknown payees, doubtful dictated amounts, drafts without an amount.
/// Picking a category makes a rule for that payee, so the same question is never asked twice.
struct ReviewView: View {
    @EnvironmentObject private var store: Store

    var body: some View {
        Page(title: "Prüfen") {
            let items = store.reviewItems
            if items.isEmpty {
                Card { Text("Nichts zu prüfen.").font(Theme.heading(18)) }
            } else {
                Text(items.count == 1 ? "1 Buchung" : "\(items.count) Buchungen").font(.system(size: 14)).foregroundStyle(Theme.muted)
                ForEach(items) { tx in ReviewCard(tx: tx) }
            }
        }
    }
}

private struct ReviewCard: View {
    @EnvironmentObject private var store: Store
    let tx: Transaction
    @State private var amountText = ""

    var body: some View {
        Card {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(tx.counterparty).font(Theme.heading(18))
                    if !tx.purpose.isEmpty { Text(tx.purpose).font(.system(size: 13)).foregroundStyle(Theme.muted).lineLimit(2) }
                    if let said = tx.captureText { Text("„\(said)“").font(.system(size: 13)).foregroundStyle(Theme.muted) }
                }
                Spacer()
                Amount(cents: tx.amountCents, size: 18)
            }
            Text(Day.short(tx.bookingDate) + (tx.source == .voice ? " · Bar" : "")).font(.system(size: 13)).foregroundStyle(Theme.muted)
            if tx.amountCents == 0 {
                HStack {
                    TextField("Betrag, z. B. 7,50", text: $amountText).keyboardType(.decimalPad).font(Theme.number())
                    Button("Übernehmen") {
                        if let cents = try? Money.parseGermanAmount(amountText), cents > 0 { store.setAmount(tx.id, cents: -cents) }
                    }.buttonStyle(InkButtonStyle()).fixedSize()
                }
            }
            Menu {
                ForEach(store.categories) { c in
                    Button(c.name) { store.setCategory(tx.id, c.id) }
                }
            } label: {
                HStack {
                    Text(store.categoryName(tx.categoryId) ?? "Kategorie wählen")
                    Spacer()
                    Image(systemName: "chevron.down")
                }
                .font(.system(size: 16, weight: .semibold))
                .padding(.vertical, 12).padding(.horizontal, 14)
                .foregroundStyle(Theme.ink)
                .overlay(Rectangle().stroke(Theme.ink, lineWidth: 2))
            }
            HStack(spacing: 10) {
                if tx.categoryId != nil {
                    Button("Passt so") { store.confirm(tx.id) }.buttonStyle(InkButtonStyle(primary: true))
                }
                Button("Löschen", role: .destructive) { store.delete(tx.id) }.buttonStyle(InkButtonStyle())
            }
        }
    }
}
