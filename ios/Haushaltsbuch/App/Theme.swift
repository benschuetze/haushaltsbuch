import SwiftUI
import UIKit

/// The e-ink ledger look of the web app: paper and ink, one accent (pen blue) for the one number that matters,
/// double-underlined like a sum in bookkeeping, small pixel-style labels above numbers and sections.
enum Theme {
    static let paper = Color(light: Color(red: 0.957, green: 0.949, blue: 0.925), dark: Color(red: 0.11, green: 0.11, blue: 0.105))
    static let card = Color(light: Color(red: 0.985, green: 0.98, blue: 0.965), dark: Color(red: 0.15, green: 0.15, blue: 0.145))
    static let ink = Color(light: Color(red: 0.12, green: 0.12, blue: 0.11), dark: Color(red: 0.92, green: 0.91, blue: 0.88))
    static let muted = Color(light: Color(red: 0.42, green: 0.42, blue: 0.4), dark: Color(red: 0.62, green: 0.62, blue: 0.6))
    static let pen = Color(light: Color(red: 0.10, green: 0.33, blue: 0.72), dark: Color(red: 0.45, green: 0.65, blue: 0.95))
    static let red = Color(light: Color(red: 0.62, green: 0.16, blue: 0.16), dark: Color(red: 0.9, green: 0.45, blue: 0.45))

    static func heading(_ size: CGFloat = 22) -> Font { .system(size: size, weight: .semibold, design: .serif) }
    static func number(_ size: CGFloat = 17) -> Font { .system(size: size, weight: .regular, design: .monospaced) }
    static let pixel: Font = .system(size: 11, weight: .semibold, design: .monospaced)
}

extension Color {
    init(light: Color, dark: Color) {
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? UIColor(dark) : UIColor(light) })
    }
}

/// Label above numbers and sections, uppercase and monospaced like a pixel font.
struct PixelLabel: View {
    let text: String
    var body: some View {
        Text(text.uppercased()).font(Theme.pixel).foregroundStyle(Theme.muted).tracking(1)
    }
}

/// An amount in cents, monospaced with tabular figures.
struct Amount: View {
    let cents: Int
    var size: CGFloat = 17
    var body: some View {
        Text(Money.format(cents)).font(Theme.number(size)).monospacedDigit()
    }
}

/// The one main number of a screen: pen blue, double-underlined.
struct Sum: View {
    let cents: Int
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Money.format(cents)).font(.system(size: 44, weight: .semibold, design: .monospaced)).monospacedDigit().foregroundStyle(Theme.pen)
            VStack(spacing: 2) {
                Rectangle().frame(height: 1.5)
                Rectangle().frame(height: 1.5)
            }.foregroundStyle(Theme.pen)
        }.fixedSize()
    }
}

/// A bookkeeping line: label, dotted leader, amount.
struct LedgerLine: View {
    let label: String
    let cents: Int
    var negative = false
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(label).lineLimit(1).truncationMode(.tail)
            Leader()
            Text(negative ? "−\(Money.format(cents))" : Money.format(cents)).font(Theme.number(15)).monospacedDigit().layoutPriority(1)
        }.font(.system(size: 15))
    }
}

private struct Leader: View {
    var body: some View {
        GeometryReader { geo in
            Path { p in
                p.move(to: CGPoint(x: 0, y: geo.size.height - 3))
                p.addLine(to: CGPoint(x: geo.size.width, y: geo.size.height - 3))
            }.stroke(style: StrokeStyle(lineWidth: 1, dash: [1, 3])).foregroundStyle(Theme.muted)
        }.frame(height: 12)
    }
}

/// Objects on the page: square corners, a solid ink border, no shadow.
struct Card<Content: View>: View {
    var title: String? = nil
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title { PixelLabel(text: title) }
            content
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .overlay(Rectangle().stroke(Theme.ink, lineWidth: 2))
    }
}

struct InkButtonStyle: ButtonStyle {
    var primary = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .padding(.vertical, 12)
            .padding(.horizontal, 18)
            .frame(maxWidth: .infinity)
            .foregroundStyle(primary ? Theme.paper : Theme.ink)
            .background(primary ? Theme.ink : Theme.card)
            .overlay(Rectangle().stroke(Theme.ink, lineWidth: 2))
            .opacity(configuration.isPressed ? 0.6 : 1)
    }
}
