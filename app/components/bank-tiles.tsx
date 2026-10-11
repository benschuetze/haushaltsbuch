import { Check, FileUp, FlaskConical, Loader2, Search, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, useFetcher, useNavigation } from "react-router";
import { BankLogo, type LogoTile } from "~/components/bank-logo";
import { Button } from "~/components/ui/button";
import { type BankGroup, GROUPS, matchesSearch, type TileState } from "~/lib/bank/catalog";
import { cn } from "~/lib/utils";

export type TileView = LogoTile & {
  group: BankGroup;
  aliases?: string[];
  fileHint: string;
  exportUrl?: string;
  state: TileState;
  /** A mock account for this tile already exists. */
  mockConnected: boolean;
};

/** Steps of the simulated connection; `name` is the institution, so PayPal does not read "Bank". */
const demoSteps = (name: string) => [
  "Sichere Verbindung aufbauen",
  `Anmeldung bei ${name}`,
  "Konten finden",
  "Umsätze abrufen",
];
const STEP_COUNT = 4;

/**
 * Search filters while typing, chips narrow to one kind of institution; without either the tiles are
 * grouped under headings so the page does not read like one long wall. One click opens a dialog that does
 * the next step: off to the bank, pick the branch, or (without real access) a clearly marked mock connection.
 */
export function BankTiles({ tiles, country, demo }: { tiles: TileView[]; country: string; demo: boolean }) {
  const [selected, setSelected] = useState<TileView | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<BankGroup | null>(null);
  const filtered = tiles.filter((t) => (group === null || t.group === group) && matchesSearch(t, query));
  const sections =
    query.trim() || group
      ? [{ id: "results", label: null as string | null, items: filtered }]
      : GROUPS.map((g) => ({
          id: g.id,
          label: g.label as string | null,
          items: filtered.filter((t) => t.group === g.id),
        }));

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Bank, Karte oder Dienst suchen …"
            aria-label="Bank suchen"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-input bg-background pr-3 pl-9 text-base shadow-xs focus-visible:outline-2 focus-visible:outline-ring"
          />
        </div>
        <fieldset className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]" aria-label="Art filtern">
          {[{ id: null as BankGroup | null, label: "Alle" }, ...GROUPS].map((g) => (
            <button
              key={g.label}
              type="button"
              onClick={() => setGroup(g.id)}
              aria-pressed={group === g.id}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-sm transition focus-visible:outline-2 focus-visible:outline-ring",
                group === g.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {g.label}
            </button>
          ))}
        </fieldset>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm" role="status">
          Nichts gefunden für „{query}“. Andere Banken findest du unten unter „Andere Bank suchen“, jede Bank geht
          außerdem per Datei-Import.
        </p>
      ) : null}

      {sections.map((section) =>
        section.items.length === 0 ? null : (
          <section key={section.id} className="space-y-2" aria-label={section.label ?? "Suchergebnis"}>
            {section.label ? <h3 className="text-sm font-medium text-muted-foreground">{section.label}</h3> : null}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3">
              {section.items.map((tile) => (
                <li key={tile.id}>
                  <Tile tile={tile} onOpen={() => setSelected(tile)} />
                </li>
              ))}
            </ul>
          </section>
        ),
      )}

      {selected ? (
        <TileDialog key={selected.id} tile={selected} country={country} demo={demo} onClose={() => setSelected(null)} />
      ) : null}
    </div>
  );
}

function Tile({ tile, onOpen }: { tile: TileView; onOpen: () => void }) {
  const live = tile.state.kind !== "file" && !tile.mockConnected;
  const badge = tile.mockConnected ? "Mock verbunden" : live ? "Live" : "Mock";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col items-center gap-2 rounded-xl border bg-card p-3 transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring active:translate-y-0"
      aria-label={`${tile.name} hinzufügen`}
    >
      <BankLogo tile={tile} className="size-14 transition group-hover:scale-105" />
      <span className="flex min-h-[2.5em] w-full items-center justify-center text-center text-[0.8rem] leading-tight font-medium break-words">
        {tile.name}
      </span>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem]",
          live ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950",
        )}
      >
        {live ? <Zap className="size-3" aria-hidden="true" /> : <FlaskConical className="size-3" aria-hidden="true" />}
        {badge}
      </span>
    </button>
  );
}

function TileDialog({
  tile,
  country,
  demo,
  onClose,
}: {
  tile: TileView;
  country: string;
  demo: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [filter, setFilter] = useState("");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  const state = tile.state;
  // Without real access (and always in the demo) the connection is simulated, and says so.
  const mock = state.kind === "file" || demo;
  const matches =
    state.kind === "choose"
      ? state.aspsps.filter((a) => a.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 40)
      : [];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="tile-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border p-0 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="flex items-center gap-3 border-b p-5">
        <BankLogo tile={tile} className="size-12" />
        <div className="min-w-0">
          <h2 id="tile-title" className="text-lg font-semibold">
            {tile.name} hinzufügen
          </h2>
          <p className="text-xs text-muted-foreground">
            {mock ? "simulierte Verbindung" : "Live-Verbindung, Lesezugriff"}
          </p>
        </div>
      </div>
      {mock ? (
        <p
          className="flex items-center gap-2 border-b bg-amber-100 px-5 py-2 text-sm font-medium text-amber-950"
          data-testid="mock-banner"
        >
          <FlaskConical className="size-4 shrink-0" aria-hidden="true" />
          Mockdaten: keine echte Verbindung zu {tile.name}
        </p>
      ) : null}

      <div className="space-y-4 p-5">
        {mock ? (
          <>
            <MockConnect tile={tile} demo={demo} />
            {state.kind === "file" && !demo ? (
              <details className="rounded-lg border p-3">
                <summary className="cursor-pointer text-sm font-medium">Echte Umsätze per Datei-Import</summary>
                <div className="mt-3">
                  <FileImport tile={tile} demo={demo} busy={busy} />
                </div>
              </details>
            ) : null}
          </>
        ) : state.kind === "direct" ? (
          <Form method="post" action="/banken" className="space-y-4">
            <input type="hidden" name="intent" value="connect" />
            <input type="hidden" name="country" value={country} />
            <input type="hidden" name="bank" value={state.aspsp} />
            <p className="text-sm">
              Du meldest dich direkt bei {tile.name} an und gibst dem Haushaltsbuch Lesezugriff. Dein Passwort sieht die
              App nie. Danach kommen die Umsätze jeden Morgen von selbst.
            </p>
            <Button type="submit" className="w-full" disabled={busy} autoFocus>
              {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Zap aria-hidden="true" />}
              Weiter zu {tile.name}
            </Button>
          </Form>
        ) : state.kind === "choose" ? (
          <Form method="post" action="/banken" className="space-y-3">
            <input type="hidden" name="intent" value="connect" />
            <input type="hidden" name="country" value={country} />
            <label htmlFor="tile-filter" className="block text-sm">
              Welche {tile.name}? ({state.aspsps.length} verfügbar)
            </label>
            <input
              id="tile-filter"
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Ort eintippen, z. B. Köln"
              autoComplete="off"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              autoFocus
            />
            <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label={`${tile.name} auswählen`}>
              {matches.map((name) => (
                <li key={name}>
                  <button
                    type="submit"
                    name="bank"
                    value={name}
                    disabled={busy}
                    className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {name}
                  </button>
                </li>
              ))}
              {matches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">Nichts gefunden.</li>
              ) : null}
            </ul>
          </Form>
        ) : null}
      </div>

      <form method="dialog" className="flex justify-end border-t p-3">
        <Button type="submit" variant="ghost">
          Schließen
        </Button>
      </form>
    </dialog>
  );
}

function FileImport({ tile, demo, busy }: { tile: TileView; demo: boolean; busy: boolean }) {
  const [file, setFile] = useState<string | null>(null);
  return (
    <Form method="post" action="/import" encType="multipart/form-data" className="space-y-4">
      <input type="hidden" name="accountId" value="" />
      <ol className="space-y-3 text-sm">
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
            1
          </span>
          <span>
            Bei {tile.name} exportieren: {tile.fileHint}{" "}
            {tile.exportUrl ? (
              <a
                href={tile.exportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Direkt zum Export
              </a>
            ) : null}
          </span>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
            2
          </span>
          <span>Datei hier ablegen. Format und Konto erkennt die App selbst.</span>
        </li>
      </ol>
      <label
        htmlFor="tile-file"
        className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center text-sm transition hover:border-foreground/30 hover:bg-accent/50"
      >
        <FileUp className="size-6 text-muted-foreground" aria-hidden="true" />
        {file ?? "Datei auswählen (CSV, CAMT, MT940)"}
      </label>
      <input
        id="tile-file"
        name="file"
        type="file"
        accept=".csv,text/csv,.xml,application/xml,text/xml,.sta,.mt940,.txt"
        required
        className="sr-only"
        onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)}
      />
      <Button type="submit" className="w-full" disabled={busy || demo || !file}>
        {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        {demo ? "In der Demo abgeschaltet" : "Importieren"}
      </Button>
    </Form>
  );
}

/**
 * Plays the steps of a bank connection, then (outside the demo) creates the mock account with invented
 * bookings, so subscriptions, hints and budgets react like after a real connection.
 */
function MockConnect({ tile, demo }: { tile: TileView; demo: boolean }) {
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [step, setStep] = useState<number | null>(null);
  const done = step !== null && step >= STEP_COUNT;

  useEffect(() => {
    if (step === null || done) return;
    const timer = setTimeout(() => setStep(step + 1), 550);
    return () => clearTimeout(timer);
  }, [step, done]);

  const { submit } = fetcher;
  useEffect(() => {
    if (done && !demo) submit({ intent: "mock", tile: tile.id }, { method: "post", action: "/banken" });
  }, [done, demo, submit, tile.id]);

  if (tile.mockConnected && step === null) {
    return (
      <p className="text-sm">
        {tile.name} ist schon als Mock verbunden.{" "}
        <Link to="/transaktionen" className="underline underline-offset-2">
          Buchungen ansehen
        </Link>
      </p>
    );
  }
  if (step === null) {
    return (
      <>
        <p className="text-sm">
          So fühlt es sich an, {tile.name} zu verbinden. Statt echter Daten legt die App ein Beispielkonto mit
          erfundenen Buchungen an. Es ist überall als „Mock“ gekennzeichnet und mit einem Klick wieder entfernt.
        </p>
        <Button className="w-full" onClick={() => setStep(0)} autoFocus>
          <Zap aria-hidden="true" />
          {demo ? "Verbindung testen (Demo)" : `Mit ${tile.name} verbinden (Mock)`}
        </Button>
      </>
    );
  }
  return (
    <ol className="space-y-2" aria-label="Verbindungsschritte">
      {demoSteps(tile.name).map((label, i) => (
        <li key={label} className="flex items-center gap-2 text-sm">
          {i < step ? (
            <Check className="size-4 text-emerald-600" aria-hidden="true" />
          ) : i === step ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <span className="size-4" aria-hidden="true" />
          )}
          <span className={i <= step ? "" : "text-muted-foreground"}>{label}</span>
        </li>
      ))}
      {done && demo ? (
        <li role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
          So sieht das Verbinden aus. Danach erscheinen die Umsätze von {tile.name} in Übersicht, Abos und Hinweisen.
          (Demo, nichts wurde verbunden.)
        </li>
      ) : done && fetcher.data ? (
        <li
          role={fetcher.data.ok ? "status" : "alert"}
          className="space-y-1 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950"
        >
          <p>{fetcher.data.message}</p>
          <p className="flex gap-3">
            <Link to="/transaktionen" className="underline underline-offset-2">
              Buchungen ansehen
            </Link>
            <Link to="/abos" className="underline underline-offset-2">
              Abos
            </Link>
          </p>
        </li>
      ) : null}
    </ol>
  );
}
