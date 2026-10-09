import { Bell } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";

export type Notifications = {
  reviewCount: number;
  unreadInsights: number;
  bankIssues: { id: string; title: string }[];
  insights: { id: string; title: string; savingsCentsPerYear: number | null }[];
};

/**
 * A <details> panel: opens and closes without JavaScript and is reachable by keyboard.
 * JavaScript only adds closing on navigation and on a click outside.
 */
export function NotificationBell({ notifications, demo }: { notifications: Notifications; demo: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  const pending = notifications.reviewCount + notifications.unreadInsights + notifications.bankIssues.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: closing is exactly what a location change should do
  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [location.key]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  return (
    <details ref={ref} className="relative" data-testid="notifications">
      <summary
        className="relative flex size-9 cursor-pointer list-none items-center justify-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
        aria-label={pending > 0 ? `Benachrichtigungen, ${pending} offen` : "Benachrichtigungen"}
      >
        <Bell className="size-5" aria-hidden="true" />
        {pending > 0 ? (
          <span
            className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-red-600 ring-2 ring-background"
            data-testid="notification-dot"
          />
        ) : null}
      </summary>
      {/* Phones: full width below the header (the bell is not at the screen edge). Wider screens: under the bell. */}
      <div className="fixed inset-x-4 top-14 z-20 space-y-3 rounded-lg border bg-background p-3 shadow-lg sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-[22rem]">
        {notifications.bankIssues.map((issue) => (
          <Link
            key={issue.id}
            to="/banken"
            className="block rounded-md border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            {issue.title}
          </Link>
        ))}
        {notifications.reviewCount > 0 && !demo ? (
          <Link
            to="/pruefen"
            className="flex items-center justify-between gap-3 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
          >
            <span>
              {notifications.reviewCount === 1 ? "1 Buchung" : `${notifications.reviewCount} Buchungen`} prüfen
            </span>
            <span aria-hidden="true">→</span>
          </Link>
        ) : null}
        {notifications.insights.length > 0 ? (
          <ul className="space-y-1">
            {notifications.insights.map((i) => (
              <li key={i.id}>
                <Link to={`/hinweise#${i.id}`} className="block rounded-md px-2 py-1.5 text-sm hover:bg-accent">
                  {i.title}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {pending === 0 && notifications.insights.length === 0 ? (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">Alles erledigt.</p>
        ) : null}
        <Link to="/hinweise" className="block px-2 text-sm underline underline-offset-4">
          Alle Hinweise
        </Link>
      </div>
    </details>
  );
}
