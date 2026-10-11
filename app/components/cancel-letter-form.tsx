import { Check, Copy, Mail, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cancelLetter, type Reference } from "~/lib/subscriptions/cancel-letter";

export type LetterHints = { numbers: Reference[]; mandate: string | null; fromDate: string } | null;

type Sender = { name: string; street: string; city: string; email: string };
const EMPTY: Sender = { name: "", street: "", city: "", email: "" };
// The sender stays on this device for the next letter; it never goes to the server.
const STORAGE_KEY = "kuendigung-absender";

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * For contracts without an online cancel page. The provider's address is entered by hand (contract, invoice,
 * imprint): a guessed address would send the cancellation nowhere. The letter is shown in full before it leaves.
 */
export function CancelLetterForm({
  merchant,
  hints,
  onSent,
}: {
  merchant: string;
  hints: LetterHints;
  onSent: () => void;
}) {
  const [sender, setSender] = useState<Sender>(EMPTY);
  const [recipientName, setRecipientName] = useState(merchant);
  const [address, setAddress] = useState("");
  const [numbers, setNumbers] = useState<Reference[]>(hints?.numbers ?? []);
  const [mandate, setMandate] = useState(hints?.mandate ?? "");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Sender | null;
      if (stored) setSender({ ...EMPTY, ...stored });
    } catch {}
  }, []);
  function updateSender(field: keyof Sender, value: string) {
    const next = { ...sender, [field]: value };
    setSender(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }

  const letter = useMemo(
    () =>
      cancelLetter({
        sender,
        recipient: { name: recipientName, address },
        numbers,
        mandate: mandate || null,
        date: today(),
      }),
    [sender, recipientName, address, numbers, mandate],
  );
  const fromDate = hints?.fromDate ? hints.fromDate.split("-").reverse().join(".") : null;

  async function copy() {
    if (!letter.ok) return;
    try {
      await navigator.clipboard.writeText(letter.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Für {merchant} kennt die App keine Kündigungsseite. Hier entsteht ein Kündigungsschreiben, das du per E-Mail
        oder Post schickst. Eine E-Mail reicht: Für Verbraucherverträge genügt seit 2022 die Textform.
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">An wen</legend>
        <div className="space-y-1 text-sm">
          <label htmlFor="letter-recipient">Anbieter</label>
          <Input id="letter-recipient" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
        </div>
        <div className="space-y-1 text-sm">
          <label htmlFor="letter-address">Anschrift des Anbieters</label>
          <textarea
            id="letter-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            placeholder={"Straße Nr.\nPLZ Ort"}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Steht im Vertrag, auf der Rechnung oder im Impressum des Anbieters. Die App rät hier bewusst nicht.{" "}
          <a
            href={`https://duckduckgo.com/?q=${encodeURIComponent(`${merchant} Impressum Anschrift`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-4"
          >
            <Search className="size-3" aria-hidden="true" />
            Impressum suchen
          </a>
        </p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Von dir</legend>
        <Input
          aria-label="Dein Name"
          placeholder="Vor- und Nachname"
          value={sender.name}
          onChange={(e) => updateSender("name", e.target.value)}
        />
        <Input
          aria-label="Straße und Hausnummer"
          placeholder="Straße und Hausnummer"
          value={sender.street}
          onChange={(e) => updateSender("street", e.target.value)}
        />
        <Input
          aria-label="PLZ und Ort"
          placeholder="PLZ und Ort"
          value={sender.city}
          onChange={(e) => updateSender("city", e.target.value)}
        />
        <Input
          aria-label="E-Mail (optional)"
          placeholder="E-Mail (optional)"
          value={sender.email}
          onChange={(e) => updateSender("email", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Bleibt nur auf diesem Gerät, für das nächste Schreiben.</p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Zuordnung</legend>
        {numbers.map((n, i) => (
          <div key={n.label} className="space-y-1 text-sm">
            <label htmlFor={`letter-number-${i}`}>{n.label}</label>
            <Input
              id={`letter-number-${i}`}
              value={n.value}
              onChange={(e) => setNumbers(numbers.map((m, j) => (j === i ? { ...m, value: e.target.value } : m)))}
            />
          </div>
        ))}
        <div className="space-y-1 text-sm">
          <label htmlFor="letter-mandate">SEPA-Mandatsreferenz (optional)</label>
          <Input id="letter-mandate" value={mandate} onChange={(e) => setMandate(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          {fromDate && (numbers.length > 0 || hints?.mandate)
            ? `Aus der Buchung vom ${fromDate} übernommen. Bitte mit dem Vertrag abgleichen.`
            : "In der Buchung stand keine Kunden- oder Vertragsnummer. Falls du eine hast, gehört sie in den Betreff."}
        </p>
      </fieldset>

      <div className="space-y-2">
        <p className="text-sm font-semibold">So geht es raus</p>
        <pre
          data-testid="cancel-letter"
          className="max-h-64 overflow-y-auto rounded border-2 border-foreground bg-background p-3 font-sans text-sm whitespace-pre-wrap"
        >
          {letter.ok ? letter.text : `Es fehlt noch: ${letter.missing.join(", ")}.`}
        </pre>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={copy} disabled={!letter.ok} variant="outline">
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Kopiert" : "Text kopieren"}
        </Button>
        {letter.ok ? (
          <Button asChild variant="outline">
            <a href={`mailto:?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.text)}`}>
              <Mail aria-hidden="true" />
              Als E-Mail öffnen
            </a>
          </Button>
        ) : (
          <Button type="button" variant="outline" disabled>
            <Mail aria-hidden="true" />
            Als E-Mail öffnen
          </Button>
        )}
      </div>
      <Button type="button" className="w-full" disabled={!letter.ok} onClick={onSent}>
        Abgeschickt
      </Button>
    </div>
  );
}
