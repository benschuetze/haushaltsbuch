import { type Booking, detectRecurring, merchantKey, merchantOf } from "~/lib/insights/recurring";

/**
 * "How much can I spend today?" The app does not know the account balance (CSV exports rarely carry it), so it
 * answers per pay period: what came in since the last salary, minus what went out, minus what is still due
 * before the next salary (fixed costs, subscriptions, the savings transfer). Spread over the days left.
 */
export type AvailableBooking = Booking & { categoryKind: string | null };

export type Due = { name: string; date: string; amountCents: number };

export type Available = {
  today: string;
  periodStart: string;
  /** Last day before the next salary (or the month's last day when no salary is known). */
  periodEnd: string;
  daysLeft: number;
  nextIncome: Due | null;
  /** The salary that should have started this period but is not in the bookings yet (export not imported?). */
  missingIncome: Due | null;
  incomeCents: number;
  spentCents: number;
  upcoming: Due[];
  upcomingCents: number;
  /** May be negative: then the period is already overdrawn. */
  freeCents: number;
  perDayCents: number;
};

const DAY = 86_400_000;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Same day next month, clamped: 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))));
}

function addDays(date: string, days: number): string {
  return iso(new Date(Date.parse(date) + days * DAY));
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY);
}

const STEP = {
  weekly: (d: string) => addDays(d, 7),
  monthly: (d: string) => addMonths(d, 1),
  quarterly: (d: string) => addMonths(d, 3),
  yearly: (d: string) => addMonths(d, 12),
};

/** The largest income that arrives every month; its next date is the next payday. */
function findSalary(
  bookings: AvailableBooking[],
  today: string,
): { name: string; last: string; amountCents: number } | null {
  const groups = new Map<string, AvailableBooking[]>();
  for (const b of bookings) {
    if (b.amountCents <= 0 || b.categoryKind !== "income" || b.bookingDate > today) continue;
    const key = merchantKey(merchantOf(b));
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  let best: { name: string; last: string; amountCents: number } | null = null;
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    items.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    const gaps = items.slice(1).map((b, i) => daysBetween((items[i] as AvailableBooking).bookingDate, b.bookingDate));
    if (!gaps.every((g) => g >= 25 && g <= 36)) continue;
    const last = items.at(-1) as AvailableBooking;
    // Too long ago: the job may have ended, better not plan with it.
    if (daysBetween(last.bookingDate, today) > 40) continue;
    if (!best || last.amountCents > best.amountCents) {
      best = { name: merchantOf(last), last: last.bookingDate, amountCents: last.amountCents };
    }
  }
  return best;
}

/** Outgoing transfers to own savings every month are planned money, not free money. */
function monthlyTransfers(bookings: AvailableBooking[], today: string) {
  const groups = new Map<string, AvailableBooking[]>();
  for (const b of bookings) {
    if (b.amountCents >= 0 || b.categoryKind !== "transfer" || b.bookingDate > today) continue;
    const key = merchantKey(merchantOf(b));
    groups.set(key, [...(groups.get(key) ?? []), b]);
  }
  return [...groups.values()]
    .filter((items) => items.length >= 2)
    .map((items) => items.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate)).at(-1) as AvailableBooking)
    .filter((last) => daysBetween(last.bookingDate, today) <= 40);
}

export function availableToSpend(bookings: AvailableBooking[], today: string): Available {
  const salary = findSalary(bookings, today);
  let periodStart: string;
  let nextIncome: Due | null = null;
  let missingIncome: Due | null = null;
  if (salary) {
    periodStart = salary.last;
    let next = addMonths(salary.last, 1);
    // A salary a few days late is still expected. Past that, the period starts on the payday that passed
    // without a booking (two months in one pot would look like double money) and the gap is reported.
    while (daysBetween(next, today) > 5) {
      periodStart = next;
      missingIncome = { name: salary.name, date: next, amountCents: salary.amountCents };
      next = addMonths(next, 1);
    }
    nextIncome = { name: salary.name, date: next, amountCents: salary.amountCents };
  } else {
    periodStart = `${today.slice(0, 7)}-01`;
  }
  const periodEnd =
    nextIncome && nextIncome.date > today
      ? addDays(nextIncome.date, -1)
      : addDays(addMonths(`${today.slice(0, 7)}-01`, 1), -1);
  const daysLeft = Math.max(1, daysBetween(today, periodEnd) + 1);

  const inPeriod = bookings.filter((b) => b.bookingDate >= periodStart && b.bookingDate <= today);
  const incomeCents = inPeriod
    .filter((b) => b.amountCents > 0 && b.categoryKind !== "transfer")
    .reduce((s, b) => s + b.amountCents, 0);
  const spentCents = inPeriod
    .filter((b) => b.amountCents < 0 && b.categoryKind !== "transfer")
    .reduce((s, b) => s - b.amountCents, 0);

  const upcoming: Due[] = [];
  const recurring = detectRecurring(
    bookings.filter((b) => b.bookingDate <= today),
    today,
  ).filter((r) => r.active);
  for (const r of recurring) {
    let due = STEP[r.cadence](r.lastDate);
    while (due <= periodEnd) {
      if (due > today || (due >= periodStart && r.lastDate < periodStart)) {
        upcoming.push({ name: r.merchant, date: due > today ? due : today, amountCents: Math.abs(r.lastAmountCents) });
      }
      due = STEP[r.cadence](due);
    }
  }
  for (const t of monthlyTransfers(bookings, today)) {
    const due = addMonths(t.bookingDate, 1);
    if (t.bookingDate < periodStart && due <= periodEnd) {
      upcoming.push({ name: merchantOf(t), date: due > today ? due : today, amountCents: -t.amountCents });
    }
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  const upcomingCents = upcoming.reduce((s, u) => s + u.amountCents, 0);
  const freeCents = incomeCents - spentCents - upcomingCents;
  return {
    today,
    periodStart,
    periodEnd,
    daysLeft,
    nextIncome,
    missingIncome,
    incomeCents,
    spentCents,
    upcoming,
    upcomingCents,
    freeCents,
    perDayCents: freeCents > 0 ? Math.floor(freeCents / daysLeft) : 0,
  };
}

export type Affordability = {
  verdict: "locker" | "geht" | "knapp" | "nein";
  amountCents: number;
  /** Free money left in the period after the purchase. */
  afterCents: number;
  perDayAfterCents: number;
};

/**
 * "Can I afford X?" Locker: fits into today's share. Geht: costs some of the coming days, at least half of the
 * daily amount stays. Knapp: still within the period, but the rest gets thin. Nein: the period would go negative.
 */
export function canAfford(a: Available, amountCents: number): Affordability {
  const afterCents = a.freeCents - amountCents;
  const perDayAfterCents = afterCents > 0 ? Math.floor(afterCents / a.daysLeft) : 0;
  const verdict =
    afterCents < 0
      ? "nein"
      : amountCents <= a.perDayCents
        ? "locker"
        : perDayAfterCents >= a.perDayCents / 2
          ? "geht"
          : "knapp";
  return { verdict, amountCents, afterCents, perDayAfterCents };
}
