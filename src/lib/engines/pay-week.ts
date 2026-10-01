/**
 * The pay week. PURE — no database, no clock of its own.
 *
 * Wages are settled every Saturday for the week that has just finished, so a pay
 * period runs Sunday to Saturday. Getting the boundary wrong by a day either pays a
 * shift twice or leaves it out, which is why this is a function with tests rather than
 * a date subtraction written inline on the payroll screen.
 */

const DAY = 24 * 60 * 60 * 1000;

/** Saturday. Date.getUTCDay(): Sunday is 0, Saturday is 6. */
const SATURDAY = 6;

export type PayWeek = { start: string; end: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The week being paid on `on`. On a Saturday that is the week ending that very day —
 * pay day settles the week just worked, including the Saturday itself. On any other
 * day it is the most recently finished week.
 */
export function payWeekFor(on: Date): PayWeek {
  const day = new Date(`${iso(on)}T00:00:00.000Z`);
  const weekday = day.getUTCDay();

  const daysSinceSaturday = (weekday - SATURDAY + 7) % 7;
  const end = new Date(day.getTime() - daysSinceSaturday * DAY);
  const start = new Date(end.getTime() - 6 * DAY);
  return { start: iso(start), end: iso(end) };
}

/** The week before the one `on` falls in — for paying late, or re-running. */
export function previousPayWeek(on: Date): PayWeek {
  const current = payWeekFor(on);
  const earlier = new Date(`${current.start}T00:00:00.000Z`).getTime() - DAY;
  return payWeekFor(new Date(earlier));
}
