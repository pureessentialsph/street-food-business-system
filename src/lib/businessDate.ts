import { addDays, format, parseISO, startOfDay, subHours } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Business date, not timestamp, is the reporting key (spec §3 rule 7).
 * A cart closing at 01:30 still belongs to the previous business day, because the
 * cutoff hour (default 04:00 Manila) has not passed yet.
 */
export const DEFAULT_TIMEZONE = "Asia/Manila";
export const DEFAULT_CUTOFF_HOUR = 4;

export type BusinessDate = string; // "YYYY-MM-DD"

export function businessDateFor(
  instant: Date = new Date(),
  cutoffHour: number = DEFAULT_CUTOFF_HOUR,
  timeZone: string = DEFAULT_TIMEZONE,
): BusinessDate {
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 23) {
    throw new Error(`cutoffHour must be an integer 0-23, received ${cutoffHour}`);
  }
  const local = toZonedTime(instant, timeZone);
  return format(subHours(local, cutoffHour), "yyyy-MM-dd");
}

/** Midnight UTC of the business date — what goes in a Prisma `@db.Date` column. */
export function toDateColumn(businessDate: BusinessDate): Date {
  return new Date(`${businessDate}T00:00:00.000Z`);
}

export function fromDateColumn(value: Date): BusinessDate {
  return format(toZonedTime(value, "UTC"), "yyyy-MM-dd");
}

/** Real clock window [start, end) covered by a business date, for timestamp queries. */
export function businessDayRange(
  businessDate: BusinessDate,
  cutoffHour: number = DEFAULT_CUTOFF_HOUR,
  timeZone: string = DEFAULT_TIMEZONE,
): { start: Date; end: Date } {
  const localMidnight = startOfDay(parseISO(businessDate));
  const start = fromZonedTime(
    format(addHoursLocal(localMidnight, cutoffHour), "yyyy-MM-dd'T'HH:mm:ss"),
    timeZone,
  );
  const end = fromZonedTime(
    format(addHoursLocal(addDays(localMidnight, 1), cutoffHour), "yyyy-MM-dd'T'HH:mm:ss"),
    timeZone,
  );
  return { start, end };
}

function addHoursLocal(date: Date, hours: number): Date {
  const copy = new Date(date);
  copy.setHours(copy.getHours() + hours);
  return copy;
}

export function trailingBusinessDates(end: BusinessDate, days: number): BusinessDate[] {
  const out: BusinessDate[] = [];
  const endDate = parseISO(end);
  for (let i = days - 1; i >= 0; i -= 1) out.push(format(addDays(endDate, -i), "yyyy-MM-dd"));
  return out;
}

export function formatBusinessDate(businessDate: BusinessDate): string {
  return format(parseISO(businessDate), "EEE, d MMM yyyy");
}
