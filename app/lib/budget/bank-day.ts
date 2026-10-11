/**
 * Banks in Germany book on TARGET2 business days: Monday to Friday, without nationwide public holidays, and
 * without 24 and 31 December. A salary or debit "due" on a Sunday arrives on the next such day.
 */

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Easter Sunday, anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const holidayCache = new Map<number, Set<string>>();

function closedDays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const e = easter(year).getTime();
  const fromEaster = (days: number) => iso(new Date(e + days * 86_400_000));
  const days = new Set([
    `${year}-01-01`,
    fromEaster(-2), // Karfreitag
    fromEaster(1), // Ostermontag
    `${year}-05-01`,
    fromEaster(39), // Christi Himmelfahrt
    fromEaster(50), // Pfingstmontag
    `${year}-10-03`,
    `${year}-12-24`,
    `${year}-12-25`,
    `${year}-12-26`,
    `${year}-12-31`,
  ]);
  holidayCache.set(year, days);
  return days;
}

export function isBankDay(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !closedDays(Number(date.slice(0, 4))).has(date);
}

/** The date itself if banks work that day, otherwise the next day they do. */
export function bankDay(date: string): string {
  let d = date;
  while (!isBankDay(d)) d = iso(new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000));
  return d;
}
