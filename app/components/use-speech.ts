import { useCallback, useEffect, useRef, useState } from "react";

/** The few members of the browser's recognizer this app touches; the DOM lib does not type it. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type RecognitionConstructor = new () => Recognition;

/** Chrome and Safari still ship the prefixed name. Null where the browser has no speech API (e.g. Firefox). */
export function detectSpeech(win: object): RecognitionConstructor | null {
  const w = win as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const found = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return typeof found === "function" ? (found as RecognitionConstructor) : null;
}

/**
 * Dictation through the browser's own recognizer. The browser, and in Chrome and Safari its vendor's server (Google,
 * Apple), handles the audio; the app only ever receives the transcript. `supported` is null until mounted so server
 * and first client render agree.
 */
export function useSpeech(onText: (text: string) => void) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  // The callback changes every render; the recognizer must keep calling the latest one.
  const latest = useRef(onText);
  latest.current = onText;

  useEffect(() => {
    setSupported(detectSpeech(window) !== null);
    return () => recognition.current?.abort();
  }, []);

  /**
   * Ends the session and cuts the handlers: a recognizer may still deliver a final result after the text was
   * submitted, and that must not write into a field that was cleared for the next sentence.
   */
  const cancel = useCallback(() => {
    const rec = recognition.current;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    rec.abort();
    recognition.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = detectSpeech(window);
    if (!Ctor) return;
    cancel();
    setError(null);
    const rec = new Ctor();
    rec.lang = "de-DE";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      // Every result so far, interim and final, replaces the field: the recognizer revises earlier words.
      const text = Array.from(event.results, (r) => r[0]?.transcript ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      latest.current(text);
    };
    rec.onerror = () =>
      setError("Die Spracheingabe hat nicht geklappt. Prüfe die Mikrofon-Freigabe oder tippe den Satz.");
    // The reference outlives the session on purpose: a result can arrive after "end", and cancel() must reach it.
    rec.onend = () => setListening(false);
    recognition.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      setListening(false);
      setError("Die Spracheingabe konnte nicht starten.");
    }
  }, [cancel]);

  const stop = useCallback(() => recognition.current?.stop(), []);

  return { supported, listening, error, start, stop, cancel };
}
