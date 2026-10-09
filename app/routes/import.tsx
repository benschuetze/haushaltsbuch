import { data, Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { isDemo } from "~/lib/auth.server";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { accounts } from "~/lib/db/schema";
import { countLabel } from "~/lib/format";
import { bankProfiles } from "~/lib/import/profiles";
import { type ImportResult, importCsv } from "~/lib/import/run";
import { listAccounts } from "~/lib/queries";
import type { Route } from "./+types/import";

export const meta: Route.MetaFunction = () => [{ title: "Import · Haushaltsbuch" }];

const MAX_BYTES = 5 * 1024 * 1024;

const accountSchema = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen für das Konto angeben.").max(60, "Der Name ist zu lang."),
  bankProfile: z.string().refine((id) => id in bankProfiles, "Bitte eine Bank wählen."),
});

const inputSchema = z.object({
  accountId: z.uuid("Bitte ein Konto wählen."),
  file: z
    .instanceof(File, { message: "Bitte eine CSV-Datei wählen." })
    .refine((f) => f.size > 0, "Die Datei ist leer.")
    .refine((f) => f.size <= MAX_BYTES, "Die Datei ist größer als 5 MB."),
});

export async function loader() {
  const accountRows = await listAccounts(getDb());
  return {
    demo: isDemo(),
    profiles: Object.values(bankProfiles).map((p) => ({ id: p.id, label: p.label })),
    accounts: accountRows.map((a) => ({
      id: a.id,
      name: a.name,
      profile: bankProfiles[a.bankProfile]?.label ?? a.bankProfile,
    })),
  };
}

type ActionData =
  | { ok: true; filename: string; result: ImportResult; accountId: string }
  | { ok: true; createdAccount: { id: string; name: string } }
  | { ok: false; error: string };

async function createAccount(form: FormData) {
  const parsed = accountSchema.safeParse({ name: form.get("name"), bankProfile: form.get("bankProfile") });
  if (!parsed.success) {
    return data<ActionData>(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const [account] = await getDb()
    .insert(accounts)
    .values(parsed.data)
    .onConflictDoNothing({ target: accounts.name })
    .returning({ id: accounts.id, name: accounts.name });
  if (!account) {
    return data<ActionData>({ ok: false, error: `Ein Konto „${parsed.data.name}“ gibt es schon.` }, { status: 400 });
  }
  return data<ActionData>({ ok: true, createdAccount: account });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  if (form.get("intent") === "createAccount") return createAccount(form);
  const parsed = inputSchema.safeParse({ accountId: form.get("accountId"), file: form.get("file") });
  if (!parsed.success) {
    return data<ActionData>(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const { accountId, file } = parsed.data;
  try {
    const result = await importCsv(getDb(), {
      accountId,
      filename: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      model: getModel(),
    });
    return data<ActionData>({ ok: true, filename: file.name, result, accountId });
  } catch (error) {
    // Profile mismatches are expected user errors (wrong bank, wrong file) and carry a readable message.
    return data<ActionData>(
      { ok: false, error: error instanceof Error ? error.message : "Import fehlgeschlagen." },
      { status: 400 },
    );
  }
}

export default function Import({ loaderData, actionData }: Route.ComponentProps) {
  const { demo, accounts: accountList, profiles } = loaderData;
  const busy = useNavigation().state === "submitting";
  const selectedAccount =
    actionData && "createdAccount" in actionData
      ? actionData.createdAccount.id
      : actionData && "accountId" in actionData
        ? actionData.accountId
        : undefined;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Kontoauszug importieren</h1>
      {demo ? <p className="rounded-lg border p-4">In der Demo ist der Import abgeschaltet.</p> : null}
      <Form method="post" encType="multipart/form-data" className="max-w-md space-y-4">
        <fieldset disabled={demo || busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="accountId">Konto</Label>
            <select
              id="accountId"
              name="accountId"
              required
              // The action result can render once before the reloaded account list arrives; keying on the list
              // too remounts the select when the new account is actually there.
              key={`${selectedAccount}-${accountList.length}`}
              defaultValue={selectedAccount}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {accountList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.profile})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="file">CSV-Datei</Label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
            />
          </div>
          <Button type="submit" name="intent" value="import">
            {busy ? "Importiere …" : "Importieren"}
          </Button>
        </fieldset>
      </Form>

      <details className="max-w-md rounded-lg border p-4" open={accountList.length <= 1 || undefined}>
        <summary className="cursor-pointer font-medium">Neues Konto anlegen</summary>
        <Form method="post" className="mt-4 space-y-4">
          <input type="hidden" name="intent" value="createAccount" />
          <fieldset disabled={demo || busy} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="account-name">Name</Label>
              <Input id="account-name" name="name" required maxLength={60} placeholder="z. B. Sparkasse Girokonto" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-bank">Bank</Label>
              <select
                id="account-bank"
                name="bankProfile"
                required
                defaultValue=""
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="" disabled>
                  Bank wählen
                </option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline">
              Konto anlegen
            </Button>
          </fieldset>
        </Form>
      </details>

      {actionData && !actionData.ok ? (
        <p role="alert" className="rounded-lg border border-destructive p-4 text-destructive">
          {actionData.error}
        </p>
      ) : null}

      {actionData?.ok && "createdAccount" in actionData ? (
        <p role="status" className="rounded-lg border p-4 text-sm">
          Konto „{actionData.createdAccount.name}“ angelegt und oben ausgewählt.
        </p>
      ) : null}
      {actionData?.ok && "result" in actionData ? (
        <ImportSummary filename={actionData.filename} result={actionData.result} />
      ) : null}
    </div>
  );
}

function ImportSummary({ filename, result }: { filename: string; result: ImportResult }) {
  const rows: [string, number, string][] = [
    ["Zeilen in der Datei", result.total, "total"],
    ["Neu", result.inserted, "inserted"],
    ["Duplikate (schon vorhanden)", result.duplicates, "duplicates"],
    ["Abgelehnt", result.rejected.length, "rejected"],
    ["Vorgemerkt, noch nicht gebucht", result.skipped.length, "skipped"],
    ["Per Regel kategorisiert", result.byRule, "by-rule"],
    ["Per KI kategorisiert", result.byAi, "by-ai"],
    ["Zu prüfen", result.needsReview, "needs-review"],
  ];
  return (
    <section role="status" aria-label="Ergebnis des Imports" className="space-y-4 rounded-lg border p-4">
      <h2 className="font-semibold">Ergebnis für {filename}</h2>
      <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
        {rows.map(([label, value, id]) => (
          <div key={id} className="contents">
            <dt>{label}</dt>
            <dd className="text-right tabular-nums" data-testid={`import-${id}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {result.rejected.length > 0 ? (
        <div className="space-y-1 text-sm">
          <h3 className="font-semibold">Abgelehnte Zeilen</h3>
          <ul className="list-inside list-disc">
            {result.rejected.map((r) => (
              <li key={r.line}>
                Zeile {r.line}: {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {result.skipped.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Vorgemerkte Umsätze übernimmt die App erst, wenn die Bank sie gebucht hat. Sie kommen beim nächsten Export
          automatisch mit.
        </p>
      ) : null}
      {result.needsReview > 0 ? (
        <Link to="/transaktionen?pruefen=1" className="inline-block text-sm underline underline-offset-4">
          {countLabel(result.needsReview, "Buchung", "Buchungen")} prüfen
        </Link>
      ) : null}
    </section>
  );
}
