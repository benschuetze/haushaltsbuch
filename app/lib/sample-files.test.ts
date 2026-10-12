import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SAMPLE_FILES } from "./sample-files";

describe("Beispieldateien zum Herunterladen", () => {
  it.each(SAMPLE_FILES)("$file ist eine unveränderte Kopie aus beispieldaten/", ({ file, source }) => {
    // Copies in public/ so the demo can offer them; they must not drift from the tested originals.
    expect(readFileSync(`public/beispiele/${file}`)).toEqual(readFileSync(source));
  });
});
