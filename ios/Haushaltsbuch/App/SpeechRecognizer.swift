import AVFoundation
import Foundation
import Speech

/// Dictation that stays on the phone: on-device recognition is required, so the microphone audio never reaches
/// Apple's servers. On a device without the German on-device model the recogniser reports that instead of falling
/// back to the cloud.
@MainActor
final class SpeechRecognizer: ObservableObject {
    @Published var transcript = ""
    @Published var listening = false
    @Published var problem: String?

    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "de-DE"))
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?

    var available: Bool { recognizer?.isAvailable == true && recognizer?.supportsOnDeviceRecognition == true }

    func toggle() {
        if listening { stop() } else { Task { await start() } }
    }

    func start() async {
        problem = nil
        guard let recognizer, recognizer.isAvailable else {
            problem = "Spracherkennung ist auf diesem Gerät nicht verfügbar."
            return
        }
        guard recognizer.supportsOnDeviceRecognition else {
            problem = "Deutsche Spracherkennung auf dem Gerät fehlt. In den iOS-Einstellungen unter Allgemein › Tastatur › Diktieren die Sprache Deutsch laden; ohne sie wird nichts erkannt, damit kein Ton das iPhone verlässt."
            return
        }
        let speech = await withCheckedContinuation { c in SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) } }
        guard speech == .authorized else {
            problem = "Spracherkennung ist nicht erlaubt (Einstellungen › Haushaltsbuch)."
            return
        }
        let mic = await AVAudioApplication.requestRecordPermission()
        guard mic else {
            problem = "Mikrofon ist nicht erlaubt (Einstellungen › Haushaltsbuch)."
            return
        }
        do {
            try startEngine(with: recognizer)
            listening = true
        } catch {
            problem = "Mikrofon konnte nicht gestartet werden: \(error.localizedDescription)"
            cleanup()
        }
    }

    private func startEngine(with recognizer: SFSpeechRecognizer) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = true
        request.taskHint = .dictation
        self.request = request

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in request.append(buffer) }
        engine.prepare()
        try engine.start()
        transcript = ""

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            Task { @MainActor in
                guard let self else { return }
                if let result { self.transcript = result.bestTranscription.formattedString }
                if error != nil || result?.isFinal == true { self.stop() }
            }
        }
    }

    func stop() {
        guard listening || engine.isRunning else { return }
        listening = false
        cleanup()
    }

    private func cleanup() {
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
