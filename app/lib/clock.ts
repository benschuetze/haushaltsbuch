/**
 * The one place the server asks for the time. Business logic takes `now` as a parameter and defaults to this,
 * so the browser tests can pin the clock (FIXED_NOW, an ISO timestamp): the demo bookings are dated August and
 * September 2026, and "is this subscription still active" or "which month is running" must not change their
 * answer as the calendar moves on. Unset, which is every real deployment, it is the system clock.
 */
export function clockNow(): Date {
  // The browser bundle has no process; there it is always the real clock.
  const fixed = typeof process !== "undefined" ? process.env.FIXED_NOW : undefined;
  if (!fixed) return new Date();
  const date = new Date(fixed);
  if (Number.isNaN(date.getTime())) throw new Error(`FIXED_NOW ist kein gültiger Zeitpunkt: ${fixed}`);
  return date;
}
