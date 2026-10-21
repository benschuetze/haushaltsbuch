import { describe, expect, it } from "vitest";
import { detectSpeech, speechErrorMessage } from "./use-speech";

describe("speechErrorMessage", () => {
  it("nennt für jeden Fehlercode den Grund und was zu tun ist", () => {
    const denied = "Kein Zugriff aufs Mikrofon. Erlaube es in den Browser-Einstellungen oder tippe den Satz.";
    expect(speechErrorMessage("not-allowed")).toBe(denied);
    expect(speechErrorMessage("service-not-allowed")).toBe(denied);
    expect(speechErrorMessage("no-speech")).toBe("Nichts gehört. Tippe nochmal aufs Mikrofon und sprich den Satz.");
    expect(speechErrorMessage("audio-capture")).toBe("Kein Mikrofon gefunden.");
    expect(speechErrorMessage("network")).toBe("Die Spracherkennung braucht Internet.");
  });

  it("schweigt bei „aborted“, weil das die App selbst auslöst", () => {
    expect(speechErrorMessage("aborted")).toBeNull();
  });

  it("fällt bei unbekanntem oder fehlendem Code auf den allgemeinen Text zurück", () => {
    const fallback = "Die Spracheingabe hat nicht geklappt. Prüfe die Mikrofon-Freigabe oder tippe den Satz.";
    expect(speechErrorMessage("language-not-supported")).toBe(fallback);
    expect(speechErrorMessage(undefined)).toBe(fallback);
  });
});

describe("detectSpeech", () => {
  it("findet die Standard-API und die mit webkit-Präfix", () => {
    class Standard {}
    class Prefixed {}
    expect(detectSpeech({ SpeechRecognition: Standard })).toBe(Standard);
    expect(detectSpeech({ webkitSpeechRecognition: Prefixed })).toBe(Prefixed);
    expect(detectSpeech({ SpeechRecognition: Standard, webkitSpeechRecognition: Prefixed })).toBe(Standard);
  });

  it("liefert null ohne Spracherkennung, damit die Seite den Knopf weglässt", () => {
    expect(detectSpeech({})).toBeNull();
    expect(detectSpeech({ SpeechRecognition: undefined, webkitSpeechRecognition: undefined })).toBeNull();
    expect(detectSpeech({ webkitSpeechRecognition: "kaputt" })).toBeNull();
  });
});
