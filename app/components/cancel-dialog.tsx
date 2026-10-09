import { Check, ExternalLink, Loader2, Scissors } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";

export type CancelTarget = {
  merchant: string;
  url: string;
  /** False when the app only knows a search for the provider's cancel button. */
  direct: boolean;
  yearlyCents?: number | null;
};

const euro = (cents: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Math.abs(cents) / 100);

/**
 * Provider pages cannot be embedded and their answer cannot be read, so the page opens in its own window
 * and the app asks once the user is back. Whether it really worked is then checked against the bookings.
 */
export function CancelDialog({ target, demo, onClose }: { target: CancelTarget; demo: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const [stage, setStage] = useState<"start" | "away" | "ask">("start");
  const saved = fetcher.data?.ok === true;

  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);

  // Coming back to this tab (or window) after the provider's page is the cue to ask how it went.
  useEffect(() => {
    if (stage !== "away") return;
    const back = () => {
      if (document.visibilityState === "visible") setStage("ask");
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [stage]);

  function openProvider() {
    // noopener: the provider's page gets no handle on this tab. A popup window on wide screens, a tab on phones.
    const wide = window.matchMedia("(min-width: 768px)").matches;
    window.open(target.url, "_blank", wide ? "popup,width=520,height=760,noopener,noreferrer" : "noopener,noreferrer");
    setStage("away");
  }

  function confirm() {
    fetcher.submit({ intent: "cancel", merchant: target.merchant }, { method: "post", action: "/abos" });
  }

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="cancel-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border p-0 shadow-2xl backdrop:bg-black/40 backdrop:backdrop-blur-sm"
    >
      <div className="space-y-1 border-b p-5">
        <h2 id="cancel-title" className="flex items-center gap-2 text-lg font-semibold">
          <Scissors className="size-5" aria-hidden="true" />
          {target.merchant} kündigen
        </h2>
        {target.yearlyCents ? (
          <p className="text-sm text-muted-foreground">
            Spart <strong className="text-foreground">{euro(target.yearlyCents)}</strong> im Jahr.
          </p>
        ) : null}
      </div>

      <div className="space-y-4 p-5">
        {saved ? (
          <p role="status" className="flex gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {fetcher.data?.message}
          </p>
        ) : stage === "start" ? (
          <>
            <p className="text-sm">
              {target.direct
                ? `Öffnet die Kündigungsseite von ${target.merchant} in einem eigenen Fenster. Dort anmelden und kündigen, danach geht's hier weiter.`
                : `Für ${target.merchant} kennt die App keine feste Kündigungsseite. Die Suche führt zum Kündigungsbutton, den jeder Online-Vertrag haben muss.`}
            </p>
            <Button className="w-full" onClick={openProvider} autoFocus>
              <ExternalLink aria-hidden="true" />
              {target.direct ? "Kündigungsseite öffnen" : "Kündigungsbutton suchen"}
            </Button>
            <button
              type="button"
              onClick={() => setStage("ask")}
              className="w-full text-center text-sm underline underline-offset-4"
            >
              Schon gekündigt
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-medium">
              {stage === "away" ? `Kündigung bei ${target.merchant} läuft …` : "Hat die Kündigung geklappt?"}
            </p>
            <p className="text-sm text-muted-foreground">
              Danach prüft die App bei jeder neuen Buchung, ob {target.merchant} trotzdem abbucht, und meldet sich in
              beiden Fällen.
            </p>
            {fetcher.data && !fetcher.data.ok ? (
              <p role="alert" className="text-sm text-destructive">
                {fetcher.data.message}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button onClick={confirm} disabled={demo || fetcher.state !== "idle"} className="flex-1">
                {fetcher.state !== "idle" ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
                {demo ? "In der Demo abgeschaltet" : "Ja, gekündigt"}
              </Button>
              <Button variant="outline" onClick={openProvider} className="flex-1">
                Seite nochmal öffnen
              </Button>
            </div>
          </>
        )}
      </div>

      <form method="dialog" className="flex justify-end border-t p-3">
        <Button type="submit" variant="ghost">
          {saved ? "Fertig" : "Schließen"}
        </Button>
      </form>
    </dialog>
  );
}
