import { useEffect, useState } from "react";
import {
  data,
  Form,
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useRouteLoaderData,
} from "react-router";
import { Assistant } from "~/components/assistant";
import { NotificationBell } from "~/components/notification-bell";
import { TabBar } from "~/components/tab-bar";
import { ThemeSwitch } from "~/components/theme-switch";
import { guard, isDemo, isLoggedIn, isReadOnly } from "~/lib/auth.server";
import { bankIssues } from "~/lib/bank/index.server";
import { getAssistantModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { resetDemoNightly } from "~/lib/demo-reset.server";
import { notificationSummary, openInsights, refreshInsightsIfStale } from "~/lib/insights";
import { applySecurityHeaders, isCrossSiteWrite } from "~/lib/security.server";
import { cancelLinkFor } from "~/lib/subscriptions/cancel-links";
import { readTheme } from "~/lib/theme.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/root";
import { useNonce } from "./nonce";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }, next) => {
    try {
      if (isCrossSiteWrite(request)) {
        throw new Response("Anfrage von fremder Seite abgelehnt.", { status: 403 });
      }
      await guard(request);
      // Before any loader reads: the first request of the night puts the demo back to the example data.
      if (isDemo()) await resetDemoNightly(getDb());
    } catch (error) {
      // Redirects to the login and rejections need the same headers as everything else.
      if (error instanceof Response) applySecurityHeaders(error.headers);
      throw error;
    }
    const response = await next();
    applySecurityHeaders(response.headers);
    return response;
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const demo = isDemo();
  const theme = await readTheme(request);
  const loggedIn = demo || (await isLoggedIn(request));
  if (!loggedIn) return data({ demo, readOnly: false, loggedIn, theme, notifications: null, assistant: false });
  const db = getDb();
  await refreshInsightsIfStale(db);
  const [summary, top, bank] = await Promise.all([notificationSummary(db), openInsights(db, 5), bankIssues(db)]);
  return data({
    demo,
    readOnly: isReadOnly(),
    loggedIn,
    theme,
    assistant: (await getAssistantModel()) !== null,
    notifications: {
      ...summary,
      bankIssues: bank,
      insights: top.map((i) => ({
        id: i.id,
        kind: i.kind,
        title: i.title,
        savingsCentsPerYear: i.savingsCentsPerYear,
        // Only hints about one merchant that is still charging get a cancel button.
        cancel: i.subject && CANCELLABLE.has(i.kind) ? { merchant: i.subject, ...cancelLinkFor(i.subject) } : null,
      })),
    },
  });
}

const CANCELLABLE = new Set(["subscription_found", "price_increase", "cancellation_failed"]);

const NAV = [
  { to: "/", label: "Übersicht", end: true },
  { to: "/buchungen", label: "Buchungen", end: false },
  { to: "/budgets", label: "Budgets", end: false },
  { to: "/ziele", label: "Sparziele", end: false },
  { to: "/abos", label: "Abos", end: false },
  { to: "/import", label: "Import", end: false },
  { to: "/regeln", label: "Regeln", end: false },
  { to: "/banken", label: "Banken", end: false },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData<typeof loader>("root");
  const nonce = useNonce();
  const [chatOpen, setChatOpen] = useState(false);
  // The start page has its own question box; a second way into the same assistant there only competes with it.
  const location = useLocation();
  const onHome = location.pathname === "/";
  const resetDone = new URLSearchParams(location.search).get("zurueckgesetzt") === "1";
  // Marks the moment React has taken over the server-rendered page; E2E tests wait for it before typing.
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return (
    <html lang="de" data-theme={root?.theme && root.theme !== "system" ? root.theme : undefined}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        {/* Installable on the home screen; opens without browser bars like an app. */}
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <meta name="theme-color" content="#f3efe5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Haushalt" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        {root?.demo ? (
          <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
            {root.readOnly ? (
              "Demo mit erfundenen Beispieldaten. Nur lesen, Änderungen sind abgeschaltet. "
            ) : (
              <>
                Demo mit erfundenen Beispieldaten: Probier alles aus, auch Import und Regeln. Alle Besucher sehen
                dieselben Daten, deshalb keine echten Kontoauszüge hochladen. Jede Nacht geht es zurück auf die
                Beispiele. {resetDone ? <strong role="status">Zurückgesetzt. </strong> : null}
                <Form method="post" action="/demo/reset" className="inline">
                  <button type="submit" className="font-medium underline underline-offset-2">
                    Jetzt zurücksetzen
                  </button>
                </Form>
                {" · "}
              </>
            )}
            <a
              href="https://github.com/benschuetze/haushaltsbuch"
              className="font-medium underline underline-offset-2"
              rel="noopener noreferrer"
              target="_blank"
            >
              Code und Architektur auf GitHub
            </a>
          </p>
        ) : null}
        {root?.loggedIn ? (
          <header className="sticky top-0 z-10 border-b-2 border-foreground bg-background">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2 sm:pb-0">
              <NavLink to="/" className="flex items-baseline gap-2">
                <span className="font-serif text-xl font-bold italic">Haushaltsbuch</span>
                <span className="pixel hidden text-muted-foreground sm:inline">Nr. 1 · Eigenes Konto</span>
              </NavLink>
              <div className="flex items-center gap-1">
                {root.notifications ? (
                  <NotificationBell notifications={root.notifications} readOnly={root.readOnly} />
                ) : null}
                {root.demo ? null : (
                  <Form method="post" action="/logout">
                    <button
                      type="submit"
                      className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                    >
                      Abmelden
                    </button>
                  </Form>
                )}
              </div>
            </div>
            {/* Scrolls sideways on small screens instead of wrapping into several rows. */}
            <nav
              aria-label="Hauptnavigation"
              className="mx-auto hidden max-w-5xl gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] sm:flex"
            >
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  // Code and data load while the pointer is on its way: the page change feels instant.
                  prefetch="intent"
                  className={({ isActive }) =>
                    cn(
                      "shrink-0 rounded-md px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                      isActive && "bg-accent font-medium",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </header>
        ) : null}
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <footer className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 pb-24 text-xs text-muted-foreground">
          <a href="/datenschutz" className="underline underline-offset-2">
            Datenschutz
          </a>
          <a href="/nutzungsbedingungen" className="underline underline-offset-2">
            Nutzungsbedingungen
          </a>
          <a href="/impressum" className="underline underline-offset-2">
            Impressum
          </a>
          <span className="ml-auto">
            <ThemeSwitch current={root?.theme ?? "system"} />
          </span>
        </footer>
        {root?.assistant ? <Assistant open={chatOpen} onOpenChange={setChatOpen} launcher={!onHome} /> : null}
        {root?.loggedIn ? (
          <TabBar
            chatOpen={chatOpen}
            onChat={() => (onHome ? document.getElementById("ask-today-input")?.focus() : setChatOpen((o) => !o))}
            assistant={Boolean(root.assistant)}
            askInPage={onHome}
          />
        ) : null}
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Etwas ist schiefgelaufen";
  let details = "Ein unerwarteter Fehler ist aufgetreten.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    title = error.status === 404 ? "Seite nicht gefunden" : `Fehler ${error.status}`;
    // A loader that throws with its own message knows better than the generic text.
    // A loader's own message beats the generic text; React Router's internal "Error: No route matches …" does not.
    details =
      typeof error.data === "string" && error.data && !error.data.startsWith("Error:")
        ? error.data
        : error.status === 404
          ? "Diese Seite gibt es nicht. Vielleicht ein alter Link?"
          : error.statusText;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p>{details}</p>
      <p>
        <Link to="/" className="underline underline-offset-4">
          Zur Übersicht
        </Link>
      </p>
      {stack ? (
        <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </div>
  );
}
