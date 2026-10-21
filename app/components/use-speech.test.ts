import { describe, expect, it } from "vitest";
import { detectSpeech } from "./use-speech";

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
