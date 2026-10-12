import { eq } from "drizzle-orm";
import { data, redirect } from "react-router";
import { z } from "zod";
import { getDb } from "~/lib/db/client";
import { accounts } from "~/lib/db/schema";
import type { Route } from "./+types/konten";

/** Accounts are a section of the bank page now; the old address leads there. Renaming is still handled here. */
export function loader() {
  return redirect("/banken#konten");
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
