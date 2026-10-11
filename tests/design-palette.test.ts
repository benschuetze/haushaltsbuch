import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The e-ink look remaps Tailwind's palette in app.css. A shade that is used but not remapped falls back to
 * Tailwind's colour (amber-200 is yellow) and breaks the look without any other test noticing.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("E-Ink-Palette", () => {
  it("jede benutzte Farbstufe ist in app.css auf Papier und Tinte umgefärbt", () => {
    const css = readFileSync("app/app.css", "utf8");
    const used = new Set<string>();
    for (const file of files("app")) {
      for (const m of readFileSync(file, "utf8").matchAll(
        /\b(?:bg|text|border|ring|fill|stroke|from|to|outline|decoration)-((?:amber|emerald|rose|red|yellow|green|orange|lime|sky|blue|indigo|violet|purple|pink|slate|gray|zinc|neutral|stone|teal|cyan|fuchsia)-\d+)\b/g,
      ))
        used.add(m[1] as string);
    }
    const missing = [...used].filter((shade) => !css.includes(`--color-${shade}:`)).sort();
    expect(missing).toEqual([]);
  });
});
