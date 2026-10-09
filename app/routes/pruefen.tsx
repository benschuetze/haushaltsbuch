import { useEffect, useRef } from "react";
import { data, Form, Link, useNavigation, useSearchParams } from "react-router";
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

export default function Pruefen({ loaderData, actionData }: Route.ComponentProps) {
  const { tx, remaining, categories, demo } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const skip = params.get("skip");

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

  return (
    <div className="mx-auto max-w-xl space-y-6">
      {actionData?.decision ? <SavedDialog key={tx.id} decision={actionData.decision} /> : null}
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Prüfen</h1>
        <p className="text-sm text-muted-foreground" data-testid="review-remaining">
          noch {remaining}
        </p>
      </div>

      <section aria-label="Buchung" className="space-y-2 rounded-lg border p-4">
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
      </section>

      <Form method="post" className="space-y-3">
        <input type="hidden" name="transactionId" value={tx.id} />
        <fieldset disabled={demo || busy}>
          <legend className="mb-2 text-sm font-medium">Wohin gehört die Buchung?</legend>
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
