import { ArrowUp, Loader2, Mic, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { RichText } from "~/components/rich-text";
import { formatCents } from "~/lib/money";
import { cn } from "~/lib/utils";

export type TodayView = {
  today: string;
  periodStart: string;
  periodEnd: string;
  perDayCents: number;
  freeCents: number;
  daysLeft: number;
  nextIncome: { name: string; date: string; amountCents: number } | null;
  missingIncome: { name: string; date: string; amountCents: number } | null;
  incomeCents: number;
  spentCents: number;
  savedCents: number;
  upcoming: { name: string; date: string; amountCents: number }[];
};

const SUGGESTIONS = [
  "Wie viel kann ich heute ausgeben?",
  "Kann ich mir 80 € fürs Feiern leisten?",
  "Wann kommt mein Gehalt?",
  "Was geht diese Woche noch ab?",
];

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "UTC" }).format(
    Date.UTC(y, m - 1, d),
  );
}

/** One ledger line: label, dotted leader, amount. */
function Line({ label, cents }: { label: string; cents: number }) {
  return (
    <li className="flex items-baseline gap-2">
      <span className="min-w-0 truncate">{label}</span>
      <span className="leader" />
      <span className="shrink-0">{cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents)}</span>
    </li>
  );
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

/**
 * Speak instead of type. Uses the browser's own speech recognition (Safari, Chrome); where there is none,
 * the button does not appear. The spoken question is sent as soon as speaking ends.
 */
function useSpeech(onFinal: (text: string) => void, onPartial: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const ref = useRef<Recognition | null>(null);
  useEffect(() => {
    const w = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    setSupported(Boolean(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);
  function toggle() {
    if (listening) {
      ref.current?.stop();
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "de-DE";
    r.interimResults = true;
    let text = "";
    r.onresult = (e) => {
      text = Array.from(e.results)
        .map((res) => res[0]?.transcript ?? "")
        .join("");
      onPartial(text);
    };
    r.onend = () => {
      setListening(false);
      if (text.trim()) onFinal(text);
    };
    r.onerror = () => setListening(false);
    ref.current = r;
    setListening(true);
    r.start();
  }
  return { supported, listening, toggle };
}

type Turn = { id: number; question: string; answer: string | null };

/**
 * The first thing on the start page: today's number, no question needed, and right below a box to ask
 * anything ("Kann ich mir … leisten?"). The answer appears in place; a follow-up keeps the last turns.
 */
/**
 * The "frech" voice works (see TONE in agent.server.ts) but is switched off for now: the demo should show one
 * calm voice. Setting this to true brings the choice back, including a stored preference.
 */
const TONE_CHOICE = false;

export function AskToday({ today, assistant }: { today: TodayView; assistant: boolean }) {
  const fetcher = useFetcher<{ answer: string; tools: string[] }>();
  const [draft, setDraft] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  // A per-device preference; nothing about it belongs in the database.
  const [tone, setTone] = useState<"freundlich" | "frech">("freundlich");
  useEffect(() => {
    try {
      if (TONE_CHOICE && localStorage.getItem("ton") === "frech") setTone("frech");
    } catch {}
  }, []);
  function chooseTone(next: "freundlich" | "frech") {
    setTone(next);
    try {
      localStorage.setItem("ton", next);
    } catch {}
  }
  const handled = useRef<unknown>(null);
  const nextId = useRef(0);
  // Set at once, not on the next render: iOS can submit twice in one moment (keyboard "Go" plus the end of
  // dictation). A second request would cancel the first and leave its question spinning forever.
  const pending = useRef(false);
  const busy = fetcher.state !== "idle";
  const inputRef = useRef<HTMLInputElement>(null);
  const speech = useSpeech(
    (text) => ask(text),
    (text) => setDraft(text),
  );
  // The home-screen shortcut "Frag einfach" opens with ?fragen=1: straight into the question box.
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get("fragen") === "1") inputRef.current?.focus();
  }, [params]);
  const overdrawn = today.freeCents < 0;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && handled.current !== fetcher.data) {
      handled.current = fetcher.data;
      pending.current = false;
      const answer = fetcher.data.answer;
      setTurns((t) => t.map((turn, i) => (i === t.length - 1 ? { ...turn, answer } : turn)));
    }
  }, [fetcher.state, fetcher.data]);

  function ask(text: string) {
    const question = text.trim().slice(0, 500);
    if (!question || busy || pending.current) return;
    pending.current = true;
    const history = turns
      .slice(-2)
      .flatMap((t) => [
        { role: "user" as const, content: t.question },
        ...(t.answer ? [{ role: "assistant" as const, content: t.answer }] : []),
      ]);
    nextId.current += 1;
    setTurns((t) => [...t.slice(-2), { id: nextId.current, question, answer: null }]);
    setDraft("");
    fetcher.submit(
      { messages: JSON.stringify([...history, { role: "user", content: question }]), ton: tone },
      { method: "post", action: "/assistent" },
    );
  }

  return (
    <section aria-labelledby="today-title" className="space-y-5 rounded border-2 border-foreground bg-card p-5">
      <div className="space-y-2">
        <h2 id="today-title" className="pixel text-muted-foreground">
          Tagesbudget
        </h2>
        <p
          className={cn("font-mono text-5xl font-bold tracking-tight", overdrawn ? "text-red-700" : "text-foreground")}
          data-testid="today-amount"
        >
          <span className={overdrawn ? "" : "summe"}>{formatCents(today.perDayCents)}</span>
        </p>
        <p className="text-sm" data-testid="today-context">
          {overdrawn
            ? `Bis ${today.nextIncome ? `zum Gehalt am ${longDate(today.nextIncome.date)}` : "Monatsende"} fehlen ${formatCents(-today.freeCents)}.`
            : `${formatCents(today.freeCents)} frei bis ${today.nextIncome ? `zum Gehalt am ${longDate(today.nextIncome.date)}` : "Monatsende"} · noch ${today.daysLeft === 1 ? "1 Tag" : `${today.daysLeft} Tage`}`}
        </p>
        {today.missingIncome ? (
          <p className="border-2 border-dashed border-foreground px-3 py-2 text-sm" data-testid="missing-income">
            Das Gehalt vom {longDate(today.missingIncome.date)} ist noch nicht in den Buchungen. Die Zahl rechnet ohne;
            nach dem nächsten Import oder Bankabruf stimmt sie wieder.
          </p>
        ) : null}
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Wie gerechnet?</summary>
          <ul className="mt-2 space-y-1 font-mono text-xs">
            <Line label="Eingenommen seit Gehalt" cents={today.incomeCents} />
            <Line label="Ausgegeben" cents={-today.spentCents} />
            {today.savedCents > 0 ? <Line label="Schon gespart" cents={-today.savedCents} /> : null}
            {today.upcoming.map((u) => (
              <Line key={`${u.name}-${u.date}`} label={`${u.name} (${longDate(u.date)})`} cents={-u.amountCents} />
            ))}
            <li className="flex items-baseline gap-2 border-t-2 border-foreground pt-1 font-bold">
              <span>Frei, verteilt auf {today.daysLeft} Tage</span>
              <span className="leader" />
              <span>Ergibt {formatCents(today.freeCents)}</span>
            </li>
          </ul>
        </details>
      </div>

      {assistant ? (
        <div className="space-y-3">
          <form
            className="relative"
            onSubmit={(e) => {
              e.preventDefault();
              ask(draft);
            }}
          >
            <Sparkles
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              id="ask-today-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Frag einfach: Kann ich mir … leisten?"
              aria-label="Frage an dein Haushaltsbuch"
              maxLength={500}
              className={cn(
                "h-12 w-full rounded-xl border border-input bg-background pl-9 text-base shadow-xs focus-visible:outline-2 focus-visible:outline-ring",
                speech.supported ? "pr-24" : "pr-12",
              )}
            />
            {speech.supported ? (
              <button
                type="button"
                onClick={speech.toggle}
                aria-label={speech.listening ? "Zuhören beenden" : "Frage sprechen"}
                aria-pressed={speech.listening}
                className={cn(
                  "absolute top-1/2 right-12 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg",
                  speech.listening ? "animate-pulse bg-red-600 text-white" : "hover:bg-accent",
                )}
              >
                <Mic className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Fragen"
              className="absolute top-1/2 right-1.5 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowUp className="size-4" aria-hidden="true" />
              )}
            </button>
          </form>
          {TONE_CHOICE ? (
            <fieldset className="flex items-center gap-1 text-xs" aria-label="Ton der Antworten">
              <span className="text-muted-foreground">Ton:</span>
              {(["freundlich", "frech"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={tone === t}
                  onClick={() => chooseTone(t)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5",
                    tone === t ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
                  )}
                >
                  {t === "freundlich" ? "freundlich" : "frech 😏"}
                </button>
              ))}
            </fieldset>
          ) : null}
          {turns.length === 0 ? (
            <fieldset className="flex min-w-0 flex-wrap gap-2" aria-label="Vorschläge">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="rounded border-2 border-foreground bg-background px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {s}
                </button>
              ))}
            </fieldset>
          ) : (
            <ol className="space-y-3" aria-live="polite" data-testid="ask-turns">
              {turns.map((t) => (
                <li key={t.id} className="space-y-1.5">
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                    {t.question}
                  </p>
                  <p
                    className="w-fit max-w-[90%] rounded-2xl rounded-bl-sm border bg-background px-3 py-2 text-sm"
                    data-testid="ask-answer"
                  >
                    {t.answer !== null ? (
                      <RichText text={t.answer} />
                    ) : (
                      <Loader2 className="size-4 animate-spin" aria-label="Antwort kommt" />
                    )}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
