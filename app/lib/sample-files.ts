/** Invented exports to try the import with, served from public/beispiele. All data in them is made up. */
export const SAMPLE_FILES = [
  { file: "sparkasse.csv", label: "Sparkasse (CSV)", source: "beispieldaten/banken/sparkasse.csv" },
  { file: "ing.csv", label: "ING (CSV)", source: "beispieldaten/banken/ing.csv" },
  { file: "dkb.csv", label: "DKB (CSV)", source: "beispieldaten/banken/dkb.csv" },
  { file: "camt053.xml", label: "CAMT.053 (XML)", source: "beispieldaten/banken/camt053.xml" },
  {
    file: "kontoflow-export.csv",
    label: "Unbekannte Bank (Format lernt die App)",
    source: "beispieldaten/banken/neu/kontoflow-export.csv",
  },
] as const;
