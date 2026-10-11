import { Check, SkipForward } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { data, Form, Link, useNavigate, useNavigation, useSearchParams, useSubmit } from "react-router";
import { z } from "zod";
import { Amount } from "~/components/amount";
import { Button } from "~/components/ui/button";
import { isDemo } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { formatDate, formatPercent } from "~/lib/format";
import { listCategories } from "~/lib/queries";
import { decideReview, nextReview, type ReviewDecision } from "~/lib/review";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/pruefen";

export const meta: Route.MetaFunction = () => [{ title: "Prüfen · Haushaltsbuch" }];

function skipList(url: URL): string[] {
  return (url.searchParams.get("skip") ?? "").split(",").filter((id) => z.uuid().safeParse(id).success);
}

export async function loader({ request }: Route.LoaderArgs) {
  const db = getDb();
  const [{ tx, remaining }, categories] = await Promise.all([
    nextReview(db, skipList(new URL(request.url))),
    listCategories(db),
  ]);
  return {
    tx,
    remaining,
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    demo: isDemo(),
  };
}

const decideSchema = z.object({ transactionId: z.uuid(), categoryId: z.uuid() });

export async function action({ request }: Route.ActionArgs) {
  const parsed = decideSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data({ decision: null, error: "Ungültige Eingabe." }, { status: 400 });
  const decision = await decideReview(getDb(), parsed.data.transactionId, parsed.data.categoryId);
  return data({ decision, error: null });
}

/** Native <dialog>: focus is trapped and Escape closes it, without a library. */
function SavedDialog({ decision }: { decision: ReviewDecision }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="saved-title"
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border p-5 shadow-xl backdrop:bg-black/40"
    >
      <h2 id="saved-title" className="text-lg font-semibold">
        Gespeichert
      </h2>
      <p className="mt-2 text-sm">
        {decision.permanent ? (
          <>
            „{decision.counterparty}“ ist ab jetzt immer <strong>{decision.categoryName}</strong>, auch bei künftigen
            Importen.
            {decision.alsoChanged > 0
              ? ` ${decision.alsoChanged === 1 ? "1 weitere Buchung wurde" : `${decision.alsoChanged} weitere Buchungen wurden`} gleich mit zugeordnet.`
              : ""}
          </>
        ) : (
          <>
            Diese Buchung ist jetzt <strong>{decision.categoryName}</strong>. Für „{decision.counterparty}“ gibt es
            keine feste Regel, weil darüber verschiedene Händler abrechnen.
          </>
        )}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Ändern kannst du das jederzeit unter{" "}
        <Link to="/regeln" className="underline underline-offset-2">
          Regeln
        </Link>
        .
      </p>
      <form method="dialog" className="mt-4 flex justify-end">
        <Button type="submit" autoFocus>
          Weiter
        </Button>
      </form>
    </dialog>
  );
}

const SWIPE = 110;

/**
 * The booking as a card: swipe right to take the suggestion, left to look at it later. Buttons do the same,
 * so nothing depends on swiping.
 */
function SwipeCard({
  onAccept,
  onSkip,
  disabled,
  children,
}: {
  onAccept: (() => void) | null;
  onSkip: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  // The latest distance, independent of rendering: a fast flick can end before React re-renders.
  const moved = useRef(0);
  const end = () => {
    if (start.current === null) return;
    start.current = null;
    if (moved.current > SWIPE && onAccept) onAccept();
    else if (moved.current < -SWIPE) onSkip();
    moved.current = 0;
    setDx(0);
  };
  const direction = dx > 30 && onAccept ? "accept" : dx < -30 ? "skip" : null;
  return (
    <section
      aria-label="Buchung"
      data-testid="review-card"
      onPointerDown={(e) => {
        if (disabled || e.pointerType === "mouse") return;
        start.current = e.clientX;
      }}
      onPointerMove={(e) => {
        if (start.current === null) return;
        moved.current = e.clientX - start.current;
        setDx(moved.current);
      }}
      onPointerUp={end}
      onPointerCancel={() => {
        start.current = null;
        moved.current = 0;
        setDx(0);
      }}
      style={{ transform: `translateX(${dx}px) rotate(${dx / 25}deg)`, touchAction: "pan-y" }}
      className={cn(
        "relative select-none space-y-2 rounded-2xl border bg-card p-5 shadow-sm",
        start.current === null && "transition-transform",
        direction === "accept" && "border-emerald-500",
        direction === "skip" && "border-muted-foreground/40",
      )}
    >
      {direction ? (
        <span
          className={cn(
            "absolute top-3 rounded-md px-2 py-0.5 text-xs font-semibold",
            direction === "accept" ? "left-3 bg-emerald-600 text-white" : "right-3 bg-muted text-foreground",
          )}
          aria-hidden="true"
        >
          {direction === "accept" ? "Passt" : "Später"}
        </span>
      ) : null}
      {children}
    </section>
  );
}

export default function Pruefen({ loaderData, actionData }: Route.ComponentProps) {
  const { tx, remaining, categories, demo } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const skip = params.get("skip");
  const submit = useSubmit();
  const navigate = useNavigate();
  // The demo cannot save, but trying it out should feel the same: say what would happen, then show the next card.
  const [demoNote, setDemoNote] = useState<string | null>(null);

  if (!tx) {
    return (
      <div className="space-y-4">
        {actionData?.decision ? <SavedDialog key={Date.now()} decision={actionData.decision} /> : null}
        <h1 className="text-2xl font-semibold">Alles geprüft</h1>
        <p>Keine Buchung wartet mehr auf dich.</p>
        <Button asChild variant="outline">
          <Link to="/">Zur Übersicht</Link>
        </Button>
      </div>
    );
  }

  const suggested = categories.find((c) => c.id === tx.categoryId);
  const ordered = suggested ? [suggested, ...categories.filter((c) => c.id !== suggested.id)] : categories;
  const nextSkip = [skip, tx.id].filter(Boolean).join(",");
  const tryInDemo = (categoryId: string) => {
    const name = categories.find((c) => c.id === categoryId)?.name ?? "zugeordnet";
    setDemoNote(`Demo: „${tx.counterparty}“ wäre jetzt ${name}. Gespeichert wird hier nichts.`);
    navigate(`/pruefen?skip=${nextSkip}`);
  };
  const demoSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const categoryId = submitter?.getAttribute("value") || new FormData(event.currentTarget).get("categoryId");
    if (typeof categoryId === "string" && categoryId) tryInDemo(categoryId);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {actionData?.decision ? <SavedDialog key={tx.id} decision={actionData.decision} /> : null}
      {demo ? (
        <p className="rounded border-2 border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <span className="pixel block text-amber-950">Demo</span>
          In der Demo kannst du hier alles ausprobieren. Gespeichert wird nichts.
        </p>
      ) : null}
      {demoNote ? (
        <p role="status" className="text-sm font-medium">
          {demoNote}
        </p>
      ) : null}
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Prüfen</h1>
        <p className="text-sm text-muted-foreground" data-testid="review-remaining">
          noch {remaining}
        </p>
      </div>

      <SwipeCard
        disabled={busy}
        onAccept={
          suggested
            ? () =>
                demo
                  ? tryInDemo(suggested.id)
                  : submit({ transactionId: tx.id, categoryId: suggested.id }, { method: "post" })
            : null
        }
        onSkip={() => navigate(`/pruefen?skip=${nextSkip}`)}
      >
        <p className="text-sm text-muted-foreground">{formatDate(tx.bookingDate)}</p>
        <p className="text-lg font-semibold break-words" data-testid="review-counterparty">
          {tx.counterparty}
        </p>
        <p className="text-sm break-words">{tx.purpose}</p>
        <Amount cents={tx.amountCents} className="text-xl font-semibold" />
        <p className="text-sm text-muted-foreground">
          {suggested
            ? `Vorschlag der KI: ${suggested.name}${tx.aiConfidence !== null ? ` (${formatPercent(tx.aiConfidence)} sicher)` : ""}`
            : "Die KI hatte keinen Vorschlag."}
        </p>
        <p className="text-xs text-muted-foreground">
          {suggested ? "Nach rechts wischen: passt · nach links: später" : "Nach links wischen: später"}
        </p>
      </SwipeCard>

      {suggested ? (
        <Form method="post" className="flex gap-2" onSubmit={demo ? demoSubmit : undefined}>
          <input type="hidden" name="transactionId" value={tx.id} />
          <input type="hidden" name="categoryId" value={suggested.id} />
          <Button type="submit" className="h-12 flex-1 text-base" disabled={busy}>
            <Check aria-hidden="true" />
            Passt: {suggested.name}
          </Button>
          <Button asChild variant="outline" className="h-12">
            <Link to={`/pruefen?skip=${nextSkip}`} aria-label="Später">
              <SkipForward aria-hidden="true" />
            </Link>
          </Button>
        </Form>
      ) : null}

      <Form method="post" className="space-y-3" onSubmit={demo ? demoSubmit : undefined}>
        <input type="hidden" name="transactionId" value={tx.id} />
        <fieldset disabled={busy}>
          <legend className="mb-2 text-sm font-medium">
            {suggested ? "Oder doch woanders hin?" : "Wohin gehört die Buchung?"}
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ordered.map((c) => (
              <button
                key={c.id}
                type="submit"
                name="categoryId"
                value={c.id}
                className={cn(
                  "min-h-11 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                  c.id === suggested?.id && "border-primary bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </fieldset>
      </Form>
      <div className="flex justify-between gap-3 text-sm">
        <Link to={`/pruefen?skip=${nextSkip}`} className="underline underline-offset-4">
          Überspringen
        </Link>
        <Link to="/transaktionen?pruefen=1" className="text-muted-foreground underline underline-offset-4">
          Als Liste anzeigen
        </Link>
      </div>
    </div>
  );
}
