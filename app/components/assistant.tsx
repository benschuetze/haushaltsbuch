import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { RichText } from "~/components/rich-text";

type Message = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = ["Habe ich versteckte Abo-Kosten?", "Wie stehen meine Budgets?", "Wofür gebe ich am meisten aus?"];
const MAX_HISTORY = 10;

/**
 * The chat. Its open state can be held by the layout, so the phone's tab bar ("Fragen") and the floating
 * button on wider screens open the same conversation.
 */
/**
 * The visible area above the on-screen keyboard. iOS keeps the layout viewport when the keyboard opens and
 * scrolls the page instead, so a plain "inset-0" sheet would end up behind the keyboard or half off screen.
 * While open, the page underneath does not scroll.
 */
function useKeyboardSafeViewport(active: boolean): { top: number | undefined; height: number | undefined } {
  const [box, setBox] = useState<{ top: number | undefined; height: number | undefined }>({
    top: undefined,
    height: undefined,
  });
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    const update = () => setBox(vv ? { top: vv.offsetTop, height: vv.height } : { top: 0, height: window.innerHeight });
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    const previous = document.documentElement.style.overflow;
    if (window.matchMedia("(max-width: 639px)").matches) document.documentElement.style.overflow = "hidden";
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      document.documentElement.style.overflow = previous;
    };
  }, [active]);
  return box;
}

export function Assistant({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} = {}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  // Stable for the keydown listener, which is only re-attached when the chat opens or closes.
  const closeRef = useRef(() => {});
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    setOwnOpen(value);
    onOpenChange?.(value);
  };
  closeRef.current = () => setOpen(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const fetcher = useFetcher<{ answer: string; tools: string[] }>();
  const busy = fetcher.state !== "idle";
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const handled = useRef<unknown>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && handled.current !== fetcher.data) {
      handled.current = fetcher.data;
      pending.current = false;
      setMessages((m) => [...m, { role: "assistant", content: fetcher.data?.answer ?? "" }]);
    }
  }, [fetcher.state, fetcher.data]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll whenever the conversation grows
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, busy]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // On the document, not the dialog: after sending, the disabled button drops focus to <body>.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function send(text: string) {
    const content = text.trim().slice(0, 1000);
    // A ref, not fetcher.state: two submits in one moment would otherwise both get through.
    if (!content || busy || pending.current) return;
    pending.current = true;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setDraft("");
    fetcher.submit({ messages: JSON.stringify(next.slice(-MAX_HISTORY)) }, { method: "post", action: "/assistent" });
  }

  const viewport = useKeyboardSafeViewport(open);

  return (
    <>
      {open ? (
        <div
          role="dialog"
          aria-label="Assistent"
          // Phones: a full screen sheet sized to the part above the keyboard. Desktop: a panel bottom right.
          style={{ top: viewport.top, height: viewport.height }}
          className="fixed inset-x-0 z-40 flex flex-col bg-background sm:inset-x-auto sm:top-auto! sm:right-4 sm:bottom-24 sm:h-[min(34rem,calc(100dvh-8rem))]! sm:w-[24rem] sm:rounded-xl sm:border sm:shadow-2xl"
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">Assistent</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Assistent schließen"
              className="rounded-md p-1 hover:bg-accent"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div
            ref={listRef}
            className="flex-1 space-y-3 overflow-y-auto p-4"
            aria-live="polite"
            data-testid="assistant-messages"
          >
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Frag nach deinen Ausgaben, Abos oder Budgets. Ich sehe deine Buchungen, ändere aber nichts.
                </p>
                <div className="flex flex-col gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {messages.map((m, i) => (
              <p
                // biome-ignore lint/suspicious/noArrayIndexKey: messages are append-only
                key={i}
                data-role={m.role}
                className={
                  m.role === "user"
                    ? "ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "mr-8 rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap"
                }
              >
                {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
              </p>
            ))}
            {busy ? <p className="mr-8 text-sm text-muted-foreground">Sehe nach …</p> : null}
          </div>
          <form
            className="flex items-end gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <label htmlFor="assistant-input" className="sr-only">
              Frage an den Assistenten
            </label>
            <textarea
              id="assistant-input"
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder="Frage stellen …"
              className="max-h-28 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Senden"
              className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50"
            >
              <Send className="size-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Assistent schließen" : "Assistent öffnen"}
        aria-expanded={open}
        className="fixed right-4 bottom-4 z-30 hidden size-14 sm:flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {open ? <X className="size-6" aria-hidden="true" /> : <MessageCircle className="size-6" aria-hidden="true" />}
      </button>
    </>
  );
}
