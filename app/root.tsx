import {
  data,
  Form,
  isRouteErrorResponse,
  Links,
  Meta,
  NavLink,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";
import { Assistant } from "~/components/assistant";
import { NotificationBell } from "~/components/notification-bell";
import { guard, isDemo, isLoggedIn } from "~/lib/auth.server";
import { bankIssues } from "~/lib/bank/index.server";
import { getAssistantModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { notificationSummary, openInsights, refreshInsightsIfStale } from "~/lib/insights";
import { applySecurityHeaders, isCrossSiteWrite } from "~/lib/security.server";
import { cancelLinkFor } from "~/lib/subscriptions/cancel-links";
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
  const loggedIn = demo || (await isLoggedIn(request));
  if (!loggedIn) return data({ demo, loggedIn, notifications: null, assistant: false });
  const db = getDb();
  await refreshInsightsIfStale(db);
  const [summary, top, bank] = await Promise.all([notificationSummary(db), openInsights(db, 5), bankIssues(db)]);
  return data({
    demo,
    loggedIn,
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
  { to: "/transaktionen", label: "Buchungen", end: false },
  { to: "/budgets", label: "Budgets", end: false },
  { to: "/ziele", label: "Sparziele", end: false },
  { to: "/abos", label: "Abos", end: false },
  { to: "/import", label: "Import", end: false },
  { to: "/regeln", label: "Regeln", end: false },
  { to: "/banken", label: "Banken", end: false },
  { to: "/konten", label: "Konten", end: false },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData<typeof loader>("root");
  const nonce = useNonce();
  return (
    <html lang="de">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh">
        {root?.demo ? (
          <p className="bg-amber-100 px-4 py-2 text-center text-sm text-amber-950">
            Demo mit erfundenen Beispieldaten. Nur lesen, Änderungen sind abgeschaltet.
          </p>
        ) : null}
        {root?.loggedIn ? (
          <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
            <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 pt-3">
              <NavLink to="/" className="font-semibold">
                Haushaltsbuch
              </NavLink>
              <div className="flex items-center gap-1">
                {root.notifications ? <NotificationBell notifications={root.notifications} demo={root.demo} /> : null}
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
              className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none]"
            >
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
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
        <footer className="mx-auto flex max-w-5xl gap-4 px-4 pb-24 text-xs text-muted-foreground">
          <a href="/datenschutz" className="underline underline-offset-2">
            Datenschutz
          </a>
          <a href="/nutzungsbedingungen" className="underline underline-offset-2">
            Nutzungsbedingungen
          </a>
        </footer>
        {root?.assistant ? <Assistant /> : null}
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
    details =
      typeof error.data === "string" && error.data
        ? error.data
        : error.status === 404
          ? "Diese Seite gibt es nicht."
          : error.statusText;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p>{details}</p>
      {stack ? (
        <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs">
          <code>{stack}</code>
        </pre>
      ) : null}
    </div>
  );
}
