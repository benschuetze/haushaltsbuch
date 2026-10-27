import SwiftUI

@main
struct HaushaltsbuchApp: App {
    @StateObject private var store = Store()

    var body: some Scene {
        WindowGroup {
            RootView().environmentObject(store)
        }
    }
}

struct RootView: View {
    @EnvironmentObject private var store: Store

    var body: some View {
        TabView {
            TodayView().tabItem { Label("Heute", systemImage: "sun.max") }
            CaptureView().tabItem { Label("Erfassen", systemImage: "mic") }
            AssistantView().tabItem { Label("Fragen", systemImage: "bubble.left") }
            ReviewView().tabItem { Label("Prüfen", systemImage: "checkmark.circle") }
                .badge(store.ledger.reviewCount)
            ImportView().tabItem { Label("Import", systemImage: "doc.badge.plus") }
        }
        .tint(Theme.pen)
    }
}

/// Page scaffold: paper background, serif title, content in a scroll view.
struct Page<Content: View>: View {
    let title: String
    /// A gear in the navigation bar; the toolbar has to live inside the NavigationStack to show up.
    var onSettings: (() -> Void)? = nil
    @ViewBuilder var content: Content
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) { content }
                    .padding(16)
            }
            .background(Theme.paper)
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.large)
            .toolbar {
                if let onSettings {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button(action: onSettings) { Image(systemName: "gearshape") }.accessibilityLabel("Einstellungen")
                    }
                }
            }
        }
        .foregroundStyle(Theme.ink)
    }
}
