import { data, Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { isDemo } from "~/lib/auth.server";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { countLabel } from "~/lib/format";
import { bankProfiles } from "~/lib/import/profiles";
import { type ImportResult, importCsv } from "~/lib/import/run";
import { listAccounts } from "~/lib/queries";
import type { Route } from "./+types/import";

export const meta: Route.MetaFunction = () => [{ title: "Import · Haushaltsbuch" }];

const MAX_BYTES = 5 * 1024 * 1024;

const inputSchema = z.object({
  accountId: z.uuid("Bitte ein Konto wählen."),
  file: z
    .instanceof(File, { message: "Bitte eine CSV-Datei wählen." })
    .refine((f) => f.size > 0, "Die Datei ist leer.")
    .refine((f) => f.size <= MAX_BYTES, "Die Datei ist größer als 5 MB."),
});

export async function loader() {
  const accounts = await listAccounts(getDb());
  return {
    demo: isDemo(),
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      profile: bankProfiles[a.bankProfile]?.label ?? a.bankProfile,
    })),
  };
}

type ActionData = { ok: true; filename: string; result: ImportResult } | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
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
    return data<ActionData>({ ok: true, filename: file.name, result });
  } catch (error) {
    // Profile mismatches are expected user errors (wrong bank, wrong file) and carry a readable message.
    return data<ActionData>(
      { ok: false, error: error instanceof Error ? error.message : "Import fehlgeschlagen." },
      { status: 400 },
    );
  }
}

export default function Import({ loaderData, actionData }: Route.ComponentProps) {
  const { demo, accounts } = loaderData;
  const busy = useNavigation().state === "submitting";

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
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
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
          <Button type="submit">{busy ? "Importiere …" : "Importieren"}</Button>
        </fieldset>
      </Form>

      {actionData && !actionData.ok ? (
        <p role="alert" className="rounded-lg border border-destructive p-4 text-destructive">
          {actionData.error}
        </p>
      ) : null}

      {actionData?.ok ? <ImportSummary filename={actionData.filename} result={actionData.result} /> : null}
    </div>
  );
}

function ImportSummary({ filename, result }: { filename: string; result: ImportResult }) {
  const rows: [string, number, string][] = [
    ["Zeilen in der Datei", result.total, "total"],
    ["Neu", result.inserted, "inserted"],
    ["Duplikate (schon vorhanden)", result.duplicates, "duplicates"],
    ["Abgelehnt", result.rejected.length, "rejected"],
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
      {result.needsReview > 0 ? (
        <Link to="/transaktionen?pruefen=1" className="inline-block text-sm underline underline-offset-4">
          {countLabel(result.needsReview, "Buchung", "Buchungen")} prüfen
        </Link>
      ) : null}
    </section>
  );
}
