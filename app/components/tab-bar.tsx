import { Home, List, Menu, MessageCircle, Wallet } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { cn } from "~/lib/utils";

const MORE = [
  { to: "/ziele", label: "Sparziele" },
  { to: "/abos", label: "Abos" },
  { to: "/rueckblick", label: "Monatsrückblick" },
  { to: "/hinweise", label: "Hinweise" },
  { to: "/import", label: "Import" },
  { to: "/banken", label: "Banken" },
  { to: "/regeln", label: "Regeln" },
];

const tab =
  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.7rem] focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Phones: the five things within thumb reach, the question in the middle. Everything else sits under
 * "Mehr", a <details> panel that works without JavaScript and closes on navigation.
 */
export function TabBar({
  chatOpen,
  onChat,
  assistant,
  askInPage = false,
}: {
  chatOpen: boolean;
  onChat: () => void;
  assistant: boolean;
  /** The page has its own question box: "Fragen" jumps there instead of opening the chat on top. */
  askInPage?: boolean;
}) {
  const more = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: closing is exactly what a location change should do
  useEffect(() => {
    if (more.current) more.current.open = false;
  }, [location.key]);

  const link = ({ isActive }: { isActive: boolean }) => cn(tab, isActive ? "font-semibold" : "text-muted-foreground");

  return (
    <nav
      aria-label="Schnellnavigation"
      className="fixed inset-x-0 bottom-0 z-20 border-t-2 border-foreground bg-background pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <div className="flex items-stretch">
        <NavLink prefetch="intent" to="/" end className={link}>
          <Home className="size-5" aria-hidden="true" />
          Übersicht
        </NavLink>
        <NavLink prefetch="intent" to="/buchungen" className={link}>
          <List className="size-5" aria-hidden="true" />
          Buchungen
        </NavLink>
        {assistant ? (
          <button
            type="button"
            onClick={onChat}
            aria-label={askInPage ? "Zum Fragefeld" : chatOpen ? "Assistent schließen" : "Assistent öffnen"}
            aria-expanded={askInPage ? undefined : chatOpen}
            className={cn(tab, "font-semibold")}
          >
            <span className="-mt-5 flex size-12 items-center justify-center rounded-full border-2 border-foreground bg-primary text-primary-foreground">
              <MessageCircle className="size-5" aria-hidden="true" />
            </span>
            Fragen
          </button>
        ) : null}
        <NavLink prefetch="intent" to="/budgets" className={link}>
          <Wallet className="size-5" aria-hidden="true" />
          Budgets
        </NavLink>
        <details ref={more} className="relative flex flex-1">
          <summary
            className={cn(tab, "cursor-pointer list-none text-muted-foreground [&::-webkit-details-marker]:hidden")}
          >
            <Menu className="size-5" aria-hidden="true" />
            Mehr
          </summary>
          <div className="fixed inset-x-3 bottom-20 rounded border-2 border-foreground bg-card p-2">
            <p className="pixel px-2 pt-1 pb-2 text-muted-foreground">Alles andere</p>
            <ul className="grid grid-cols-2 gap-1">
              {MORE.map((m) => (
                <li key={m.to}>
                  <NavLink
                    to={m.to}
                    // Opening /hinweise marks them as read, so it must not load before the tap.
                    prefetch={m.to === "/hinweise" ? "none" : "intent"}
                    className={({ isActive }) =>
                      cn("block rounded px-3 py-2.5 text-sm hover:bg-accent", isActive && "bg-accent font-semibold")
                    }
                  >
                    {m.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </nav>
  );
}
