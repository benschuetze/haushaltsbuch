import { Loader2, Mic, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { data, Link, useFetcher } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useSpeech } from "~/components/use-speech";
import { isDemo } from "~/lib/auth.server";
import { type BookingCard, describeBooking } from "~/lib/capture/present";
import { captureInputSchema, captureSpoken } from "~/lib/capture/run";
import { undoCapture } from "~/lib/capture/undo";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import type { Route } from "./+types/erfassen";

export const meta: Route.MetaFunction = () => [{ title: "Erfassen · Haushaltsbuch" }];

const DEMO_MESSAGE = "Die Demo ist schreibgeschützt.";

/**
 * The key is made on the server so the form works from the first paint and a double tap books once. Every action
 * revalidates this loader, which is what renews the key after a booking.
 */
export async function loader() {
  return { key: crypto.randomUUID(), readOnly: isDemo() };
}

const actionSchema = z.discriminatedUnion("intent", [
  captureInputSchema.extend({ intent: z.literal("book") }),
  z.object({ intent: z.literal("undo"), id: z.uuid("Ungültige Buchung.") }),
]);

type ActionData =
  | { kind: "booked"; card: BookingCard }
  | { kind: "undone"; id: string }
  /** `id` is the booking an undo was about, so a stale refusal is not shown under the next booking. */
  | { kind: "error"; intent: "book" | "undo"; message: string; id?: string };

export async function action({ request }: Route.ActionArgs) {
  const form = Object.fromEntries(await request.formData());
  const intent = form.intent === "undo" ? "undo" : "book";
  const id = typeof form.id === "string" ? form.id : undefined;
  const fail = (message: string, status: number) =>
    data<ActionData>({ kind: "error", intent, message, id }, { status });

  // Same rule as the token endpoint: demo bookings would be visible to everyone and wiped by the nightly reset.
  if (isDemo()) return fail(DEMO_MESSAGE, 403);
  const parsed = actionSchema.safeParse(form);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Ungültige Eingabe.", 400);

  const db = getDb();
  if (parsed.data.intent === "undo") {
    const result = await undoCapture(db, parsed.data.id);
    return result.ok ? data<ActionData>({ kind: "undone", id: parsed.data.id }) : fail(result.error, 409);
  }
  const result = await captureSpoken(db, parsed.data, { model: getModel() });
  return data<ActionData>({ kind: "booked", card: describeBooking(result) });
}

function Card({ card, onUndo }: { card: BookingCard; onUndo: React.ReactNode }) {
  return (
    <section aria-labelledby="booked-title" className="space-y-3 rounded border-2 border-foreground bg-card p-4">
      <h2 id="booked-title" className="pixel text-muted-foreground">
        {card.created ? "Gebucht" : "Schon gebucht"}
      </h2>
      {card.draft ? (
        <p className="text-lg">
          <span className="font-semibold">Kein Betrag erkannt.</span> Dein Satz „{card.counterparty}“ ist als Entwurf
          gespeichert, {card.dayLabel}.
        </p>
      ) : (
        <p className="text-lg">
          <span className="summe font-mono tabular-nums">{card.amountLabel}</span> · {card.counterparty} ·{" "}
          {card.categoryLabel ?? "ohne Kategorie"} · {card.dayLabel}
        </p>
      )}
      {card.needsReview ? (
        <p className="text-sm">
          <Link to="/pruefen" className="font-semibold underline underline-offset-2">
            Bitte prüfen
          </Link>{" "}
          – die Buchung wartet unter „Prüfen“ auf dich.
        </p>
      ) : null}
      {onUndo}
    </section>
  );
}

export default function Erfassen({ loaderData }: Route.ComponentProps) {
  const { key, readOnly } = loaderData;
  const book = useFetcher<ActionData>();
  const undo = useFetcher<ActionData>();
  const [text, setText] = useState("");
  const speech = useSpeech(setText);

  const booked = book.data?.kind === "booked" ? book.data.card : null;
  const removed = booked && undo.data?.kind === "undone" && undo.data.id === booked.id;
  const bookError = book.data?.kind === "error" ? book.data.message : null;
  const undoError = !removed && undo.data?.kind === "error" && undo.data.id === booked?.id ? undo.data.message : null;
  const bookingId = booked?.id;

  // A booked sentence is done; the field is ready for the next one.
  useEffect(() => {
    if (bookingId) setText("");
  }, [bookingId]);

  const busy = book.state !== "idle";
  const undoing = undo.state !== "idle";

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Erfassen</h1>
        <p className="text-sm text-muted-foreground">
          Sag oder tipp, was du bezahlt hast, z. B. „hab grad 7 Euro für nen Döner gezahlt“.
        </p>
      </header>

      <book.Form method="post" className="space-y-3">
        <input type="hidden" name="intent" value="book" />
        <input type="hidden" name="key" value={key} />
        <div className="space-y-1">
          <label htmlFor="capture-text" className="pixel block text-muted-foreground">
            Was hast du bezahlt?
          </label>
          <div className="flex gap-2">
            <Input
              id="capture-text"
              name="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              autoComplete="off"
              enterKeyHint="send"
              disabled={readOnly}
              placeholder="7 Euro Döner"
              className="h-12 flex-1 border-2 border-foreground text-base md:text-base"
            />
            {speech.supported ? (
              <Button
                type="button"
                variant={speech.listening ? "default" : "outline"}
                size="icon-lg"
                className="size-12 shrink-0 border-2 border-foreground"
                aria-pressed={speech.listening}
                aria-label={speech.listening ? "Diktat beenden" : "Diktieren"}
                disabled={readOnly}
                onClick={speech.listening ? speech.stop : speech.start}
              >
                <Mic aria-hidden="true" className="size-5" />
              </Button>
            ) : null}
          </div>
        </div>
        <Button type="submit" className="h-12 w-full text-base" disabled={readOnly || busy || text.trim() === ""}>
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Buchen
        </Button>
        {speech.supported === false ? (
          <p className="text-sm text-muted-foreground">Diktierfunktion der Tastatur nutzen</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Die Spracherkennung läuft im Browser deines Geräts. Die App speichert kein Audio, nur den Text.
        </p>
      </book.Form>

      {readOnly ? (
        <p role="alert" className="rounded border-2 border-foreground bg-amber-50 p-3 text-sm text-amber-950">
          {DEMO_MESSAGE}
        </p>
      ) : null}
      {speech.error ? (
        <p role="alert" className="rounded border-2 border-foreground p-3 text-sm">
          {speech.error}
        </p>
      ) : null}
      {bookError && !readOnly ? (
        <p role="alert" className="rounded border-2 border-foreground p-3 text-sm">
          {bookError}
        </p>
      ) : null}

      <div role="status" className="space-y-3">
        {removed ? (
          <p className="rounded border-2 border-foreground bg-card p-4">
            Buchung entfernt: {booked.amountLabel ?? "Entwurf"} · {booked.counterparty} ist wieder gelöscht.
          </p>
        ) : booked ? (
          <Card
            card={booked}
            onUndo={
              <undo.Form method="post">
                <input type="hidden" name="intent" value="undo" />
                <input type="hidden" name="id" value={booked.id} />
                <Button type="submit" variant="outline" className="h-11" disabled={undoing}>
                  <Undo2 aria-hidden="true" />
                  Rückgängig
                </Button>
              </undo.Form>
            }
          />
        ) : null}
      </div>
      {undoError ? (
        <p role="alert" className="rounded border-2 border-foreground p-3 text-sm">
          {undoError}
        </p>
      ) : null}
    </div>
  );
}
