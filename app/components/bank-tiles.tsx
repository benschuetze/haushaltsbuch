import { Check, FileUp, Loader2, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, useNavigation } from "react-router";
import { BankLogo, type LogoTile } from "~/components/bank-logo";
import { Button } from "~/components/ui/button";
import type { TileState } from "~/lib/bank/catalog";

export type TileView = LogoTile & { fileHint: string; exportUrl?: string; state: TileState };

const DEMO_STEPS = ["Sichere Verbindung aufbauen", "Anmeldung bei der Bank", "Konten finden", "Umsätze abrufen"];

/**
 * Tiles that wrap with the screen width. One click opens a dialog that does the next step straight away:
 * off to the bank, pick the branch, or drop the exported file.
 */
export function BankTiles({ tiles, country, demo }: { tiles: TileView[]; country: string; demo: boolean }) {
  const [selected, setSelected] = useState<TileView | null>(null);
  return (
    <>
      <ul
        aria-label="Banken und Zahlungsdienste"
        className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-3"
      >
        {tiles.map((tile) => {
          const live = tile.state.kind !== "file";
          return (
            <li key={tile.id}>
              <button
                type="button"
                onClick={() => setSelected(tile)}
                className="group flex w-full flex-col items-center gap-2 rounded-xl border bg-card p-3 transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring active:translate-y-0"
                aria-label={`${tile.name} hinzufügen`}
              >
                <BankLogo tile={tile} className="size-14 transition group-hover:scale-105" />
                <span className="flex min-h-[2.5em] w-full items-center justify-center text-center text-[0.8rem] leading-tight font-medium break-words">
                  {tile.name}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] ${live ? "bg-emerald-100 text-emerald-900" : "bg-muted text-foreground"}`}
                >
                  {live ? (
                    <Zap className="size-3" aria-hidden="true" />
                  ) : (
                    <FileUp className="size-3" aria-hidden="true" />
                  )}
                  {live ? "Live" : "Datei"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {selected ? (
        <TileDialog key={selected.id} tile={selected} country={country} demo={demo} onClose={() => setSelected(null)} />
      ) : null}
    </>
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
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  // The demo plays the connection instead of opening a real bank: same steps, nothing sent anywhere.
  useEffect(() => {
    if (demoStep === null || demoStep >= DEMO_STEPS.length) return;
    const timer = setTimeout(() => setDemoStep(demoStep + 1), 550);
    return () => clearTimeout(timer);
  }, [demoStep]);

  const state = tile.state;
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
            {state.kind === "file" ? "per Datei-Import" : "Live-Verbindung, Lesezugriff"}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-5">
        {state.kind !== "file" && demo ? (
          demoStep === null ? (
            <>
              <p className="text-sm">
                Du meldest dich direkt bei {tile.name} an. Das Haushaltsbuch sieht dein Passwort nie und darf nur lesen.
                Die Demo spielt den Ablauf nach, ohne eine echte Bank zu kontaktieren.
              </p>
              <Button className="w-full" onClick={() => setDemoStep(0)} autoFocus>
                Verbindung testen (Demo)
              </Button>
            </>
          ) : (
            <ol className="space-y-2" aria-label="Verbindungsschritte">
              {DEMO_STEPS.map((step, i) => (
                <li key={step} className="flex items-center gap-2 text-sm">
                  {i < demoStep ? (
                    <Check className="size-4 text-emerald-600" aria-hidden="true" />
                  ) : i === demoStep ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <span className="size-4" aria-hidden="true" />
                  )}
                  <span className={i <= demoStep ? "" : "text-muted-foreground"}>{step}</span>
                </li>
              ))}
              {demoStep >= DEMO_STEPS.length ? (
                <li role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
                  So einfach geht's: In deiner eigenen App landen die Umsätze von {tile.name} jetzt automatisch jeden
                  Morgen im Haushaltsbuch. (Demo, nichts wurde verbunden.)
                </li>
              ) : null}
            </ol>
          )
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
        ) : (
          <FileImport tile={tile} demo={demo} busy={busy} />
        )}
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
        {file ?? "CSV-Datei auswählen"}
      </label>
      <input
        id="tile-file"
        name="file"
        type="file"
        accept=".csv,text/csv"
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
