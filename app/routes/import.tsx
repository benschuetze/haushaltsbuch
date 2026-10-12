import { type ChangeEvent, useState } from "react";
import { data, Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { isDemo } from "~/lib/auth.server";
import { getModel } from "~/lib/categorize/model";
import { getDb } from "~/lib/db/client";
import { countLabel } from "~/lib/format";
import { profileLabel } from "~/lib/import/formats/detect";
import { type AutoImportResult, type ImportResult, importAuto, importCsv } from "~/lib/import/run";
import { listAccounts } from "~/lib/queries";
import type { Route } from "./+types/import";

export const meta: Route.MetaFunction = () => [{ title: "Import · Haushaltsbuch" }];

// Vercel rejects request bodies above 4.5 MB before the app sees them; stay clearly below.
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 12;
const TOO_LARGE = "Zusammen größer als 4 MB. Bitte in mehreren Runden hochladen.";

const inputSchema = z.object({
  // Empty means: let the app find the bank and the account.
  accountId: z.union([z.literal(""), z.uuid()]),
  files: z
    .array(z.instanceof(File))
    .transform((files) => files.filter((f) => f.size > 0))
    .pipe(
      z
        .array(z.instanceof(File))
        .min(1, "Bitte mindestens eine Datei wählen.")
        .max(MAX_FILES, `Höchstens ${MAX_FILES} Dateien auf einmal.`)
        .refine((files) => files.reduce((sum, f) => sum + f.size, 0) <= MAX_TOTAL_BYTES, TOO_LARGE),
    ),
});

export async function loader() {
  const db = getDb();
  const accountRows = await listAccounts(db);
  return {
    demo: isDemo(),
    accounts: await Promise.all(
      accountRows.map(async (a) => ({ id: a.id, name: a.name, bank: await profileLabel(db, a.bankProfile) })),
    ),
  };
}

type FileOutcome =
  | { filename: string; ok: true; result: ImportResult | AutoImportResult }
  | { filename: string; ok: false; error: string };

type ActionData = { ok: true; files: FileOutcome[] } | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const parsed = inputSchema.safeParse({ accountId: form.get("accountId") ?? "", files: form.getAll("file") });
  if (!parsed.success) {
    return data<ActionData>(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const { accountId, files } = parsed.data;
  const db = getDb();
  const model = getModel();
  const outcomes: FileOutcome[] = [];
  // One after another: a learned format or a new account from file 1 is then already known for file 2.
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      const result = accountId
        ? await importCsv(db, { accountId, filename: file.name, bytes, model })
        : await importAuto(db, { filename: file.name, bytes, model });
      outcomes.push({ filename: file.name, ok: true, result });
    } catch (error) {
      // Unknown formats and wrong files are expected and carry a readable message; the other files still go in.
      outcomes.push({
        filename: file.name,
        ok: false,
        error: error instanceof Error ? error.message : "Import fehlgeschlagen.",
      });
    }
  }
  return data<ActionData>({ ok: true, files: outcomes });
}

export default function Import({ loaderData, actionData }: Route.ComponentProps) {
  const { demo, accounts } = loaderData;
  const busy = useNavigation().state === "submitting";
  const [selectionProblem, setSelectionProblem] = useState<string | null>(null);

  // Checked before sending: a too large upload would otherwise end in Vercel's error page, not in a message here.
  function checkSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.currentTarget.files ?? [])];
    const total = files.reduce((sum, f) => sum + f.size, 0);
    setSelectionProblem(
      files.length > MAX_FILES
        ? `Höchstens ${MAX_FILES} Dateien auf einmal.`
        : total > MAX_TOTAL_BYTES
          ? TOO_LARGE
          : null,
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Kontoauszug importieren</h1>
        <p className="text-sm text-muted-foreground">
          Export deiner Bank hochladen (CSV, CAMT.053 oder MT940), gern mehrere auf einmal. Bank und Konto erkennt die
          App selbst; ein neues Format lernt sie beim ersten Mal.
        </p>
      </div>
      {demo ? <p className="rounded-lg border p-4">In der Demo ist der Import abgeschaltet.</p> : null}
      <Form method="post" encType="multipart/form-data" className="max-w-md space-y-4">
        <fieldset disabled={demo || busy} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="file">Kontoauszüge</Label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv,.xml,application/xml,text/xml,.sta,.mt940,.txt"
              multiple
              required
              onChange={checkSelection}
              aria-describedby={selectionProblem ? "file-problem" : undefined}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5"
            />
          </div>
          {selectionProblem ? (
            <p id="file-problem" role="alert" className="text-sm text-destructive">
              {selectionProblem}
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="accountId">Konto</Label>
            <select
              id="accountId"
              name="accountId"
              defaultValue=""
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            >
              <option value="">Automatisch erkennen</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.bank})
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={selectionProblem !== null}>
            {busy ? "Importiere …" : "Importieren"}
          </Button>
        </fieldset>
      </Form>

      {actionData && !actionData.ok ? (
        <p role="alert" className="rounded-lg border border-destructive p-4 text-destructive">
          {actionData.error}
        </p>
      ) : null}

      {actionData?.ok
        ? actionData.files.map((outcome) =>
            outcome.ok ? (
              <ImportSummary key={outcome.filename} filename={outcome.filename} result={outcome.result} />
            ) : (
              <section
                key={outcome.filename}
                aria-label={`Fehler bei ${outcome.filename}`}
                className="space-y-1 rounded-lg border border-destructive p-4"
              >
                <h2 className="font-semibold">{outcome.filename}</h2>
                <p role="alert" className="text-sm text-destructive">
                  {outcome.error}
                </p>
              </section>
            ),
          )
        : null}
    </div>
  );
}

function ImportSummary({ filename, result }: { filename: string; result: ImportResult | AutoImportResult }) {
  const rows: [string, number, string][] = [
    ["Zeilen in der Datei", result.total, "total"],
    ["Neu", result.inserted, "inserted"],
    ["Duplikate (schon vorhanden)", result.duplicates, "duplicates"],
    ["Abgelehnt", result.rejected.length, "rejected"],
    ["Übersprungen (vorgemerkt, Kontostand)", result.skipped.length, "skipped"],
    ["Per Regel kategorisiert", result.byRule, "by-rule"],
    ["Per KI kategorisiert", result.byAi, "by-ai"],
    ["Zu prüfen", result.needsReview, "needs-review"],
  ];
  const auto = "account" in result ? result : null;
  return (
    <section role="status" aria-label={`Ergebnis für ${filename}`} className="space-y-4 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 className="font-semibold">Ergebnis für {filename}</h2>
        {auto ? (
          <p className="text-sm" data-testid="import-account">
            Konto „{auto.account.name}“{auto.account.created ? " neu angelegt" : ""} · {auto.format.label}
            {auto.format.learned === "heuristic" ? " · neues Format an den Spaltennamen erkannt" : ""}
            {auto.format.learned === "ai" ? " · neues Format per KI zugeordnet" : ""}
          </p>
        ) : null}
      </div>
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
          Vorgemerkte Umsätze übernimmt die App erst, wenn die Bank sie gebucht hat; sie kommen beim nächsten Export
          automatisch mit. Kontostand-Zeilen sind keine Buchungen.
        </p>
      ) : null}
      {result.needsReview > 0 ? (
        <Link to="/buchungen?pruefen=1" className="inline-block text-sm underline underline-offset-4">
          {countLabel(result.needsReview, "Buchung", "Buchungen")} prüfen
        </Link>
      ) : null}
    </section>
  );
}
