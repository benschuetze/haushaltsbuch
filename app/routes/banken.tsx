import { eq } from "drizzle-orm";
import { data, Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { z } from "zod";
import { AccountsList } from "~/components/accounts-list";
import { BankTiles } from "~/components/bank-tiles";
import { Button } from "~/components/ui/button";
import { accountOverview } from "~/lib/account-overview.server";
import { isDemo, isReadOnly } from "~/lib/auth.server";
import { BANK_TILES, tileState } from "~/lib/bank/catalog";
import { BankApiError } from "~/lib/bank/enable-banking.server";
import { bankClient, listConnections } from "~/lib/bank/index.server";
import { connectMock, listMockAccounts, removeMock } from "~/lib/bank/mock.server";
import { bankStateCookie } from "~/lib/bank/state-cookie.server";
import { createAuthState, disconnect, syncConnection } from "~/lib/bank/sync.server";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { bankConnections } from "~/lib/db/schema";
import { formatDate } from "~/lib/format";
import { refreshInsights } from "~/lib/insights";
import { safeError } from "~/lib/security.server";
import type { Route } from "./+types/banken";

export const meta: Route.MetaFunction = () => [{ title: "Banken · Haushaltsbuch" }];

const COUNTRIES = [
  { code: "DE", name: "Deutschland" },
  { code: "AT", name: "Österreich" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const client = bankClient();
  const url = new URL(request.url);
  const country = COUNTRIES.some((c) => c.code === url.searchParams.get("land"))
    ? (url.searchParams.get("land") as string)
    : "DE";
  let banks: string[] = [];
  let listError: string | null = null;
  if (client) {
    try {
      banks = (await client.listAspsps(country)).map((a) => a.name).sort((a, b) => a.localeCompare(b, "de"));
    } catch (error) {
      console.error(`Bankenliste nicht abrufbar: ${safeError(error)}`);
      // A freshly registered production app answers 403 until its owner links own accounts in the portal.
      listError =
        error instanceof BankApiError && error.status === 403
          ? "Die Live-Anbindung ist bei Enable Banking noch nicht freigeschaltet. Bis dahin laufen alle Banken als Mock oder per Datei."
          : "Die Bankenliste ist gerade nicht erreichbar. Bitte später erneut versuchen.";
    }
  }
  const demo = isDemo();
  // The demo has no bank access: every tile is a mock there.
  const available = demo ? [] : banks;
  // RegExps do not survive serialisation to the browser, and the browser does not need them.
  const mockAccounts = await listMockAccounts(getDb());
  const tiles = BANK_TILES.map(({ match: _match, ...view }, i) => ({
    ...view,
    state: tileState(BANK_TILES[i] as (typeof BANK_TILES)[number], available),
    mockConnected: mockAccounts.some((m) => m.accountKey === `mock:${view.id}`),
  }));
  return {
    configured: client !== null,
    demo,
    readOnly: isReadOnly(),
    tiles,
    mockAccounts: mockAccounts.map(({ id, name, bookings }) => ({ id, name, bookings })),
    country,
    countries: COUNTRIES,
    banks,
    listError,
    accounts: await accountOverview(getDb()),
    connections: (await listConnections(getDb())).map((c) => ({
      ...c,
      validUntil: c.validUntil.toISOString().slice(0, 10),
      lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
    })),
  };
}

const actionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("connect"), bank: z.string().min(1).max(200), country: z.enum(["DE", "AT"]) }),
  z.object({ intent: z.literal("sync"), connectionId: z.uuid() }),
  z.object({ intent: z.literal("disconnect"), connectionId: z.uuid() }),
  z.object({ intent: z.literal("mock"), tile: z.string().max(50) }),
  z.object({ intent: z.literal("removeMock"), accountId: z.uuid() }),
]);

export async function action({ request }: Route.ActionArgs) {
  const parsed = actionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data({ ok: false as const, message: "Ungültige Eingabe." }, { status: 400 });
  const db = getDb();
  const input = parsed.data;

  // Mock connections need no bank access at all.
  if (input.intent === "mock") {
    const tile = BANK_TILES.find((t) => t.id === input.tile);
    if (!tile) return data({ ok: false as const, message: "Unbekannte Bank." }, { status: 400 });
    const result = await connectMock(db, tile);
    return data({
      ok: true as const,
      message: result.existed
        ? `${result.accountName} war schon verbunden.`
        : `Verbunden (Mock): ${result.inserted} erfundene Buchungen in „${result.accountName}“.`,
    });
  }
  if (input.intent === "removeMock") {
    const name = await removeMock(db, input.accountId);
    return name
      ? data({ ok: true as const, message: `„${name}“ mit allen Mock-Buchungen entfernt.` })
      : data({ ok: false as const, message: "Kein Mock-Konto." }, { status: 404 });
  }

  const client = bankClient();
  if (!client)
    return data({ ok: false as const, message: "Die Bankanbindung ist nicht eingerichtet." }, { status: 503 });

  if (input.intent === "connect") {
    // Only banks the provider actually lists can be started; nothing user-typed goes to the API unchecked.
    const known = await client.listAspsps(input.country);
    const aspsp = known.find((a) => a.name === input.bank);
    if (!aspsp) return data({ ok: false as const, message: "Diese Bank ist nicht in der Liste." }, { status: 400 });
    const { state, validUntil } = await createAuthState(db, { name: aspsp.name, country: aspsp.country });
    const maxValid = aspsp.maximum_consent_validity
      ? new Date(Date.now() + aspsp.maximum_consent_validity * 1000)
      : validUntil;
    try {
      const auth = await client.startAuth({
        aspsp: { name: aspsp.name, country: aspsp.country },
        state,
        redirectUrl: `${new URL(request.url).origin}/bank/callback`,
        validUntil: maxValid < validUntil ? maxValid : validUntil,
      });
      return redirect(auth.url, { headers: { "Set-Cookie": await bankStateCookie().serialize(state) } });
    } catch (error) {
      console.error(`Bankanmeldung nicht gestartet: ${safeError(error)}`);
      return data(
        { ok: false as const, message: "Die Anmeldung bei der Bank konnte nicht gestartet werden." },
        { status: 502 },
      );
    }
  }

  const [connection] = await db.select().from(bankConnections).where(eq(bankConnections.id, input.connectionId));
  if (!connection) return data({ ok: false as const, message: "Verbindung nicht gefunden." }, { status: 404 });
  if (input.intent === "disconnect") {
    await disconnect(db, client, connection.id);
    return data({
      ok: true as const,
      message: `Verbindung zu ${connection.aspspName} getrennt. Bisherige Buchungen bleiben.`,
    });
  }
  const result = await syncConnection(db, client, connection, getModel());
  await refreshInsights(db);
  return data(
    result.error
      ? { ok: false as const, message: `${connection.aspspName}: ${result.error}.` }
      : {
          ok: true as const,
          message: `${connection.aspspName}: ${result.inserted === 1 ? "1 neue Buchung" : `${result.inserted} neue Buchungen`}${result.skipped ? `, ${result.skipped} vorgemerkt` : ""}.`,
        },
  );
}

const STATUS = { active: "aktiv", expired: "abgelaufen", revoked: "getrennt", error: "Fehler" } as const;
const NOTICES: Record<string, string> = {
  state:
    "Die Rückkehr von der Bank ließ sich nicht zuordnen (abgelaufen oder aus einem anderen Browser). Bitte neu verbinden.",
  abgebrochen: "Die Anmeldung bei der Bank wurde abgebrochen.",
  fehler: "Die Verbindung konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
};

export default function Banken({ loaderData, actionData }: Route.ComponentProps) {
  const {
    configured,
    demo,
    readOnly,
    tiles,
    mockAccounts,
    country,
    countries,
    banks,
    listError,
    connections,
    accounts,
  } = loaderData;
  const [params] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  // Messages from the return URL belong to that moment; a newer action result replaces them.
  const notice = !actionData && params.get("fehler") ? NOTICES[params.get("fehler") ?? ""] : null;
  const connected = actionData ? null : params.get("verbunden");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Banken</h1>
        {/* Says what is true for this instance: the demo has no bank access, so no daily fetch to promise. */}
        <p className="text-sm text-muted-foreground" data-testid="banks-intro">
          {configured && !demo
            ? "Verbundene Konten ruft die App jeden Morgen automatisch ab. Die Anmeldung läuft direkt bei deiner Bank; die App sieht dein Bank-Passwort nie und hat nur Lesezugriff."
            : "Hier ist keine Bank angebunden. Die Kacheln zeigen den Ablauf mit Mockdaten, echte Umsätze kommen über den Import."}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/import">Kontoauszug importieren</Link>
        </Button>
      </div>
      {notice ? (
        <p role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">
          {notice}
        </p>
      ) : null}
      {connected ? (
        <p role="status" className="rounded-lg border bg-muted/50 p-4 text-sm">
          Verbunden. {connected === "1" ? "1 neue Buchung" : `${connected} neue Buchungen`} abgerufen.
        </p>
      ) : null}
      {actionData ? (
        <p
          role={actionData.ok ? "status" : "alert"}
          className={`rounded-lg border p-4 text-sm ${actionData.ok ? "bg-muted/50" : "border-destructive text-destructive"}`}
        >
          {actionData.message}
        </p>
      ) : null}

      {connections.length > 0 ? (
        <ul className="space-y-3" aria-label="Verbundene Banken">
          {connections.map((c) => (
            <li key={c.id} className="space-y-2 rounded-lg border p-4" data-testid="connection">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{c.aspspName}</h2>
                <span className="text-sm" data-testid="connection-status">
                  {STATUS[c.status]}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {c.accounts.join(", ") || "keine Konten"} · gültig bis {formatDate(c.validUntil)}
                {c.lastSyncAt ? ` · zuletzt abgerufen ${formatDate(c.lastSyncAt.slice(0, 10))}` : ""}
              </p>
              {c.status === "active" ? (
                <Form method="post" className="flex flex-wrap gap-2">
                  <input type="hidden" name="connectionId" value={c.id} />
                  <Button type="submit" name="intent" value="sync" size="sm" variant="outline" disabled={busy || demo}>
                    Jetzt abrufen
                  </Button>
                  <Button
                    type="submit"
                    name="intent"
                    value="disconnect"
                    size="sm"
                    variant="ghost"
                    disabled={busy || demo}
                  >
                    Trennen
                  </Button>
                </Form>
              ) : c.status !== "revoked" ? (
                <p className="text-sm">Bitte unten neu verbinden; bisherige Buchungen bleiben erhalten.</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {mockAccounts.length > 0 ? (
        <ul className="space-y-3" aria-label="Mock-Verbindungen">
          {mockAccounts.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-4"
              data-testid="mock-connection"
            >
              <div className="min-w-0 space-y-0.5">
                <h2 className="font-semibold">{m.name}</h2>
                <p className="text-sm text-amber-950">
                  Mockdaten · {m.bookings === 1 ? "1 erfundene Buchung" : `${m.bookings} erfundene Buchungen`}
                </p>
              </div>
              <Form method="post">
                <input type="hidden" name="accountId" value={m.id} />
                <Button
                  type="submit"
                  name="intent"
                  value="removeMock"
                  size="sm"
                  variant="outline"
                  disabled={busy || demo}
                >
                  Entfernen
                </Button>
              </Form>
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="connect" className="space-y-3">
        <div className="space-y-1">
          <h2 id="connect" className="text-lg font-semibold">
            Bank hinzufügen
          </h2>
          {listError ? <p className="text-sm text-muted-foreground">{listError}</p> : null}
        </div>
        <BankTiles tiles={tiles} country={country} readOnly={readOnly} />
      </section>

      {configured && !listError ? (
        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer font-medium">Andere Bank suchen</summary>
          <div className="mt-3 space-y-3">
            <Form method="get" className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <label htmlFor="land" className="block text-sm">
                  Land
                </label>
                <select
                  id="land"
                  name="land"
                  defaultValue={country}
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="ghost" size="sm">
                Banken laden
              </Button>
            </Form>
            <Form method="post" className="space-y-3">
              <input type="hidden" name="intent" value="connect" />
              <input type="hidden" name="country" value={country} />
              <div className="space-y-1">
                <label htmlFor="bank" className="block text-sm">
                  Bank ({banks.length} verfügbar)
                </label>
                <input
                  id="bank"
                  name="bank"
                  list="bank-list"
                  required
                  autoComplete="off"
                  placeholder="Name eintippen, z. B. Sparkasse"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                />
                <datalist id="bank-list">
                  {banks.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
              <Button type="submit" disabled={busy || demo}>
                Weiter zur Bank
              </Button>
            </Form>
          </div>
        </details>
      ) : null}
      {/* Formerly its own page "Konten": accounts belong with the banks they come from. */}
      <section id="konten" aria-labelledby="accounts-title" className="space-y-3">
        <h2 id="accounts-title" className="text-lg font-semibold">
          Deine Konten
        </h2>
        <p className="text-sm text-muted-foreground">
          Konten legt die App beim Import oder Verbinden selbst an. Hier kannst du ihnen einen besseren Namen geben.
        </p>
        <AccountsList accounts={accounts} readOnly={readOnly} />
      </section>
    </div>
  );
}
