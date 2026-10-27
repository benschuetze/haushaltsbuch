import Foundation
import SwiftUI

/// The one source of truth in the app: the ledger in memory, saved as a JSON file in the app's own container after
/// every change. Nothing is synced anywhere; the file is covered by the device backup like any other app data.
@MainActor
final class Store: ObservableObject {
    @Published private(set) var ledger: Ledger
    @Published var lastError: String?

    private let fileURL: URL
    private var saveTask: Task<Void, Never>?

    init(fileURL: URL? = nil) {
        let url = fileURL ?? Store.defaultURL()
        self.fileURL = url
        if let data = try? Data(contentsOf: url), let saved = try? JSONDecoder().decode(Ledger.self, from: data) {
            ledger = saved
        } else {
            ledger = Ledger()
        }
    }

    private static func defaultURL() -> URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("ledger.json")
    }

    var today: String { Day.today() }

    var available: Available { ledger.available(today: today) }

    var reviewItems: [Transaction] {
        ledger.transactions.filter(\.needsReview).sorted { $0.bookingDate != $1.bookingDate ? $0.bookingDate > $1.bookingDate : $0.createdAt > $1.createdAt }
    }

    var categories: [Category] { ledger.categories }

    func categoryName(_ id: String?) -> String? { ledger.category(id)?.name }

    // MARK: Changes

    private func mutate(_ change: (inout Ledger) throws -> Void) rethrows {
        var next = ledger
        try change(&next)
        ledger = next
        scheduleSave()
    }

    func importFile(_ url: URL) -> ImportOutcome? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: url)
            var outcome: ImportOutcome?
            try mutate { outcome = try $0.importFile(data, filename: url.lastPathComponent) }
            return outcome
        } catch {
            lastError = String(describing: error)
            return nil
        }
    }

    func capture(_ text: String) -> CaptureOutcome {
        var outcome: CaptureOutcome!
        mutate { outcome = $0.capture(text) }
        return outcome
    }

    func setCategory(_ transactionId: String, _ categoryId: String) {
        mutate { $0.setCategory(transactionId: transactionId, categoryId: categoryId) }
    }

    func confirm(_ transactionId: String) {
        mutate { $0.confirm(transactionId: transactionId) }
    }

    func delete(_ transactionId: String) {
        mutate { $0.delete(transactionId: transactionId) }
    }

    func setAmount(_ transactionId: String, cents: Int) {
        mutate { $0.setAmount(transactionId: transactionId, amountCents: cents) }
    }

    func eraseEverything() {
        mutate { $0 = Ledger() }
    }

    // MARK: Persistence

    /// Coalesces bursts of changes; the file is written atomically and only readable while the device is unlocked
    /// the first time after boot, which is the strongest protection class that still allows background work.
    private func scheduleSave() {
        saveTask?.cancel()
        let snapshot = ledger
        let url = fileURL
        saveTask = Task.detached(priority: .utility) {
            try? await Task.sleep(nanoseconds: 200_000_000)
            if Task.isCancelled { return }
            do {
                try Store.write(snapshot, to: url)
            } catch {
                await MainActor.run { self.lastError = "Speichern fehlgeschlagen: \(error.localizedDescription)" }
            }
        }
    }

    /// Writes right away. iOS may suspend or kill the app before the coalesced save fires, e.g. when the user books
    /// and swipes the app away; the scene calls this whenever the app leaves the foreground.
    func flush() {
        saveTask?.cancel()
        saveTask = nil
        do {
            try Store.write(ledger, to: fileURL)
        } catch {
            lastError = "Speichern fehlgeschlagen: \(error.localizedDescription)"
        }
    }

    private nonisolated static func write(_ snapshot: Ledger, to url: URL) throws {
        let data = try JSONEncoder().encode(snapshot)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}
