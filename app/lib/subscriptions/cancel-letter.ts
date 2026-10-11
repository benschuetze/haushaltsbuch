/**
 * A cancellation letter for contracts without an online cancel page (gym signed in the studio, insurance, club).
 * Nothing is guessed: the provider's address comes from the user (contract, invoice or imprint), numbers only
 * when the booking labels them as such. Fixed wording, no model: an ordinary cancellation at the next possible
 * date. Since 2022 text form is enough for consumer contracts (§ 309 Nr. 13 BGB), so an e-mail will do.
 */

export type Reference = {
  label: "Kundennummer" | "Vertragsnummer" | "Mitgliedsnummer" | "Versicherungsnummer";
  value: string;
};

const LABELS: { label: Reference["label"]; pattern: RegExp }[] = [
  { label: "Mitgliedsnummer", pattern: /\bmitglieds[-\s]?(?:nummer|nr\.?)/i },
  { label: "Vertragsnummer", pattern: /\bvertrags[-\s]?(?:nummer|nr\.?)/i },
  { label: "Versicherungsnummer", pattern: /\b(?:versicherungs[-\s]?(?:nummer|nr\.?)|vers\.?[-\s]?nr\.?)/i },
  { label: "Kundennummer", pattern: /\b(?:kunden[-\s]?(?:nummer|nr\.?)|kd\.?[-\s]?nr\.?)/i },
];

/** The value right after a label: tokens of capitals, digits and - / . that together contain a digit. */
function valueAfter(text: string): string | null {
  const tokens = text.replace(/^\s*[:.#]?\s*/, "").split(/\s+/);
  const taken: string[] = [];
  for (const [i, token] of tokens.entries()) {
    const clean = token.replace(/[,;]$/, "");
    if (!/^[A-Z0-9][A-Z0-9\-/.]*$/.test(clean)) break;
    // A short capital prefix ("LV 12-345") belongs to the number only when a number follows.
    const prefix = /^[A-Z]{1,3}$/.test(clean) && /\d/.test(tokens[i + 1] ?? "");
    if (!/\d/.test(clean) && !prefix) break;
    taken.push(clean);
    if (clean !== token) break;
  }
  const value = taken.join(" ").replace(/[.\-/]+$/, "");
  return /\d/.test(value) && value.length >= 3 && value.length <= 40 ? value : null;
}

export function referencesFrom(
  purpose: string,
  raw: Record<string, unknown>,
): { numbers: Reference[]; mandate: string | null } {
  const numbers: Reference[] = [];
  for (const { label, pattern } of LABELS) {
    const m = pattern.exec(purpose);
    if (!m) continue;
    const value = valueAfter(purpose.slice(m.index + m[0].length));
    if (value && !numbers.some((n) => n.value === value)) numbers.push({ label, value });
  }
  const fromColumn = Object.entries(raw).find(([k, v]) => /mandat/i.test(k) && typeof v === "string" && v.trim());
  const fromPurpose = /\bMREF\s*[:+]?\s*([A-Z0-9][A-Z0-9\-/.+]{2,34})/i.exec(purpose)?.[1];
  const mandate = (fromColumn?.[1] as string | undefined)?.trim() || fromPurpose || null;
  return { numbers, mandate };
}

export type LetterInput = {
  sender: { name: string; street: string; city: string; email: string };
  recipient: { name: string; address: string };
  numbers: Reference[];
  mandate: string | null;
  /** yyyy-mm-dd */
  date: string;
};

export type Letter = { ok: true; subject: string; text: string } | { ok: false; missing: string[] };

const MONTHS = [
  "Januar",
  "Februar",
  "März",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Dezember",
];

export function cancelLetter(input: LetterInput): Letter {
  const s = {
    name: input.sender.name.trim(),
    street: input.sender.street.trim(),
    city: input.sender.city.trim(),
    email: input.sender.email.trim(),
  };
  const r = { name: input.recipient.name.trim(), address: input.recipient.address.trim() };
  const missing = [
    !s.name && "Dein Name",
    !s.street && "Straße und Hausnummer",
    !s.city && "PLZ und Ort",
    !r.name && "Anbieter",
    !r.address && "Anschrift des Anbieters",
  ].filter((m): m is string => Boolean(m));
  if (missing.length > 0) return { ok: false, missing };

  const numbers = input.numbers.filter((n) => n.value.trim());
  const [y, m, d] = input.date.split("-").map(Number);
  const place = s.city.replace(/^\d{4,5}\s+/, "");
  const subject = numbers[0]
    ? `Kündigung – ${numbers[0].label} ${numbers[0].value.trim()}`
    : "Kündigung meines Vertrags";
  const lines = [
    s.name,
    s.street,
    s.city,
    ...(s.email ? [s.email] : []),
    "",
    r.name,
    r.address,
    "",
    `${place}, ${d}. ${MONTHS[(m ?? 1) - 1]} ${y}`,
    "",
    subject,
    "",
    "Sehr geehrte Damen und Herren,",
    "",
    "hiermit kündige ich den oben genannten Vertrag fristgerecht zum nächstmöglichen Zeitpunkt.",
    ...(numbers.length > 1
      ? ["", `Zur Zuordnung: ${numbers.map((n) => `${n.label} ${n.value.trim()}`).join(", ")}.`]
      : []),
    "",
    "Bitte bestätigen Sie mir den Eingang dieser Kündigung und das genaue Vertragsende schriftlich.",
    ...(input.mandate?.trim()
      ? [
          "",
          `Das SEPA-Lastschriftmandat mit der Mandatsreferenz ${input.mandate.trim()} widerrufe ich zum Vertragsende.`,
        ]
      : []),
    "",
    "Mit freundlichen Grüßen",
    "",
    s.name,
  ];
  return { ok: true, subject, text: `${lines.join("\n")}\n` };
}
