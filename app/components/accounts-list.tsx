import { useFetcher } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatDate } from "~/lib/format";
import { formatCents } from "~/lib/money";

type Account = {
  id: string;
  name: string;
  bank: string;
  bookings: number;
  balance: { date: string; cents: number } | null;
};

/** Accounts the import created, with their balance where the export carries one; renaming stays on /konten. */
export function AccountsList({ accounts, readOnly }: { accounts: Account[]; readOnly: boolean }) {
  return (
    <ul className="space-y-3">
      {accounts.map((a) => (
        <AccountRow key={a.id} account={a} readOnly={readOnly} />
      ))}
    </ul>
  );
}

function AccountRow({ account: a, readOnly }: { account: Account; readOnly: boolean }) {
  const fetcher = useFetcher<{ ok: true; name: string } | { ok: false; error: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <li className="space-y-2 rounded-lg border p-3" data-testid="account">
      <p className="text-sm text-muted-foreground">
        {a.bank} · {a.bookings === 1 ? "1 Buchung" : `${a.bookings} Buchungen`}
      </p>
      <p className="text-sm font-medium" data-testid="account-balance">
        {a.balance
          ? `Kontostand am ${formatDate(a.balance.date)}: ${formatCents(a.balance.cents)}`
          : "Kontostand: im Export nicht enthalten"}
      </p>
      <fetcher.Form method="post" action="/konten" className="flex flex-wrap items-end gap-2">
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
            disabled={readOnly}
          />
        </div>
        <Button type="submit" variant="outline" disabled={readOnly || busy}>
          Umbenennen
        </Button>
      </fetcher.Form>
      {fetcher.data?.ok ? (
        <p role="status" className="text-sm">
          Umbenannt in „{fetcher.data.name}“.
        </p>
      ) : null}
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {fetcher.data.error}
        </p>
      ) : null}
    </li>
  );
}
