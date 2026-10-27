import Foundation

/// Decodes bank exports: UTF-8 (with or without BOM), falling back to Windows-1252, which most German banks still use.
enum CSV {
    static func decode(_ bytes: Data) -> String {
        var data = bytes
        if data.starts(with: [0xEF, 0xBB, 0xBF]) { data = data.dropFirst(3) }
        if let text = String(data: data, encoding: .utf8) { return text }
        return String(data: data, encoding: .windowsCP1252) ?? String(decoding: data, as: UTF8.self)
    }

    /// Minimal RFC 4180 parser: quoted fields, doubled quotes, line breaks inside quotes. One array per physical record.
    /// Works on Unicode scalars: as Characters, "\r\n" is one grapheme cluster and Windows line ends would never match.
    static func parse(_ text: String, delimiter: Character) -> [[String]] {
        let sep = delimiter.unicodeScalars.first!
        var records: [[String]] = []
        var field = String.UnicodeScalarView()
        var record: [String] = []
        var inQuotes = false
        let scalars = Array(text.unicodeScalars)
        var i = 0
        while i < scalars.count {
            let ch = scalars[i]
            if inQuotes {
                if ch == "\"" {
                    if i + 1 < scalars.count && scalars[i + 1] == "\"" {
                        field.append("\"")
                        i += 1
                    } else {
                        inQuotes = false
                    }
                } else {
                    field.append(ch)
                }
            } else if ch == "\"" {
                inQuotes = true
            } else if ch == sep {
                record.append(String(field))
                field = String.UnicodeScalarView()
            } else if ch == "\n" || ch == "\r" {
                if ch == "\r" && i + 1 < scalars.count && scalars[i + 1] == "\n" { i += 1 }
                record.append(String(field))
                records.append(record)
                record = []
                field = String.UnicodeScalarView()
            } else {
                field.append(ch)
            }
            i += 1
        }
        if !field.isEmpty || !record.isEmpty {
            record.append(String(field))
            records.append(record)
        }
        return records
    }
}
