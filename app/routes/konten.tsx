import { count, eq } from "drizzle-orm";
import { data, Form, useNavigation } from "react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { isDemo } from "~/lib/auth.server";
import { getDb } from "~/lib/db/client";
import { accounts, transactions } from "~/lib/db/schema";
import { profileLabel } from "~/lib/import/formats/detect";
import type { Route } from "./+types/konten";

export const meta: Route.MetaFunction = () => [{ title: "Konten · Haushaltsbuch" }];

export async function loader() {
  const db = getDb();
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      bankProfile: accounts.bankProfile,
      bookings: count(transactions.id),
    })
    .from(accounts)
    .leftJoin(transactions, eq(transactions.accountId, accounts.id))
    .groupBy(accounts.id)
    .orderBy(accounts.name);
  return {
    demo: isDemo(),
    accounts: await Promise.all(rows.map(async (r) => ({ ...r, bank: await profileLabel(db, r.bankProfile) }))),
  };
}

const renameSchema = z.object({
  accountId: z.uuid(),
  name: z.string().trim().min(1, "Der Name darf nicht leer sein.").max(60, "Der Name ist zu lang."),
});

type ActionData = { ok: true; name: string } | { ok: false; error: string; accountId?: string };

export async function action({ request }: Route.ActionArgs) {
  const parsed = renameSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return data<ActionData>(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Ungültige Eingabe." },
      { status: 400 },
    );
  }
  const db = getDb();
  const [clash] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.name, parsed.data.name));
  if (clash && clash.id !== parsed.data.accountId) {
    return data<ActionData>(
      { ok: false, error: `Ein Konto „${parsed.data.name}“ gibt es schon.`, accountId: parsed.data.accountId },
      { status: 400 },
    );
  }
  await db.update(accounts).set({ name: parsed.data.name }).where(eq(accounts.id, parsed.data.accountId));
  return data<ActionData>({ ok: true, name: parsed.data.name });
}

export default function Konten({ loaderData, actionData }: Route.ComponentProps) {
  const { demo, accounts: rows } = loaderData;
  const busy = useNavigation().state === "submitting";
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Konten</h1>
        <p className="text-sm text-muted-foreground">
          Konten legt die App beim Import selbst an. Hier kannst du ihnen einen besseren Namen geben.
        </p>
      </div>
      {actionData?.ok ? (
        <p role="status" className="rounded-lg border bg-muted/50 p-4 text-sm">
          Umbenannt in „{actionData.name}“.
        </p>
      ) : null}
      {actionData && !actionData.ok ? (
        <p role="alert" className="rounded-lg border border-destructive p-4 text-sm text-destructive">
          {actionData.error}
        </p>
      ) : null}
      <ul className="space-y-3">
        {rows.map((a) => (
          <li key={a.id} className="space-y-2 rounded-lg border p-3" data-testid="account">
            <p className="text-sm text-muted-foreground">
              {a.bank} · {a.bookings === 1 ? "1 Buchung" : `${a.bookings} Buchungen`}
            </p>
            <Form method="post" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="accountId" value={a.id} />
              <div className="min-w-0 flex-1 space-y-1">
                <label htmlFor={`name-${a.id}`} className="block text-sm font-medium">
                  Name
                </label>
                <Input
                  id={`name-${a.id}`}
                  name="name"
                  defaultValue={a.name}
                  key={a.name}
                  required
                  maxLength={60}
                  disabled={demo}
                />
              </div>
              <Button type="submit" variant="outline" disabled={demo || busy}>
                Umbenennen
              </Button>
            </Form>
          </li>
        ))}
      </ul>
    </div>
  );
}
