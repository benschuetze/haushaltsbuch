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
import { guard, isDemo, isLoggedIn } from "~/lib/auth.server";
import { cn } from "~/lib/utils";
import type { Route } from "./+types/root";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }, next) => {
    await guard(request);
    return next();
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  return data({ demo: isDemo(), loggedIn: isDemo() || (await isLoggedIn(request)) });
}

const NAV = [
  { to: "/", label: "Übersicht", end: true },
  { to: "/transaktionen", label: "Buchungen", end: false },
  { to: "/import", label: "Import", end: false },
  { to: "/regeln", label: "Regeln", end: false },
  { to: "/konten", label: "Konten", end: false },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData<typeof loader>("root");
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
          <header className="border-b bg-background">
            <nav
              aria-label="Hauptnavigation"
              className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-1 gap-y-2 px-4 py-3"
            >
              <span className="mr-3 font-semibold">Haushaltsbuch</span>
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "rounded-md px-3 py-1.5 text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
                      isActive && "bg-accent font-medium",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              {root.demo ? null : (
                <Form method="post" action="/logout" className="ml-auto">
                  <button
                    type="submit"
                    className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
                  >
                    Abmelden
                  </button>
                </Form>
              )}
            </nav>
          </header>
        ) : null}
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        <ScrollRestoration />
        <Scripts />
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
