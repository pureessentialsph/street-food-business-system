/**
 * The reporting window. PURE — no database, no clock of its own.
 *
 * Every figure on a dashboard is "over what period?", and the answer arrives from a URL
 * the owner can edit, bookmark or mistype. So it is resolved in one place and checked:
 * a backwards range, a date in the future, a typo, or a window so wide it would read
 * every shift ever recorded all have a defined answer here rather than an exception on
 * the page or, worse, a total that is quietly wrong.
 */

export type DateRange = { from: string; to: string };

export type PresetKey = "today" | "yesterday" | "7d" | "14d" | "30d" | "month" | "lastMonth";

export type ResolvedRange = {
  range: DateRange;
  /** Which preset this is exactly, so the right chip can be highlighted. */
  preset: PresetKey | "custom";
  /** Days in the window, inclusive of both ends. */
  days: number;
  /** Said out loud when the request was adjusted, so a clamped total is never silent. */
  note?: string;
};

const DAY = 24 * 60 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** A year and a bit. Wide enough for "last year", narrow enough to stay one query. */
export const MAX_DAYS = 400;

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const ms = (date: string) => Date.parse(`${date}T00:00:00.000Z`);

function valid(value: string | undefined): value is string {
  return Boolean(value && ISO.test(value) && !Number.isNaN(ms(value)));
}

const shift = (date: string, days: number) => iso(ms(date) + days * DAY);

/** First and last day of the month `date` falls in. */
function monthOf(date: string): DateRange {
  const from = `${date.slice(0, 7)}-01`;
  const next = new Date(ms(from));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { from, to: iso(next.getTime() - DAY) };
}

export function presetRange(preset: PresetKey, today: string): DateRange {
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": return { from: shift(today, -1), to: shift(today, -1) };
    case "7d": return { from: shift(today, -6), to: today };
    case "14d": return { from: shift(today, -13), to: today };
    case "30d": return { from: shift(today, -29), to: today };
    case "month": return monthOf(today);
    case "lastMonth": {
      const firstOfThis = monthOf(today).from;
      return monthOf(shift(firstOfThis, -1));
    }
  }
}

export const PRESET_LABELS: Record<PresetKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "14d": "Last 14 days",
  "30d": "Last 30 days",
  month: "This month",
  lastMonth: "Last month",
};

export const DEFAULT_PRESET: PresetKey = "14d";

/**
 * `today` is the business date, not the calendar date — a cart that closes at 01:00
 * belongs to the day before, and the dashboard must agree with the shifts board.
 */
export function resolveRange(
  input: { from?: string; to?: string; preset?: string },
  today: string,
): ResolvedRange {
  if (input.preset && input.preset in PRESET_LABELS) {
    const preset = input.preset as PresetKey;
    return describe(clamp(presetRange(preset, today), today), today, preset);
  }

  // A half-filled range is a day, not an error: one end given means that single day.
  if (!valid(input.from) && !valid(input.to)) {
    return describe(clamp(presetRange(DEFAULT_PRESET, today), today), today, DEFAULT_PRESET);
  }
  const from = valid(input.from) ? input.from : input.to!;
  const to = valid(input.to) ? input.to : input.from!;

  return describe(clamp({ from, to }, today), today, null);
}

function clamp(range: DateRange, today: string): { range: DateRange; note?: string } {
  let { from, to } = range;
  const notes: string[] = [];

  // Entered backwards — read as the range they meant rather than refusing.
  if (ms(from) > ms(to)) [from, to] = [to, from];

  if (ms(to) > ms(today)) {
    to = today;
    notes.push("A day that has not happened cannot have sales, so the range ends today.");
    if (ms(from) > ms(to)) from = to;
  }

  const span = Math.round((ms(to) - ms(from)) / DAY) + 1;
  if (span > MAX_DAYS) {
    from = shift(to, -(MAX_DAYS - 1));
    notes.push(`A range is at most ${MAX_DAYS} days; showing the ${MAX_DAYS} days to ${to}.`);
  }

  return { range: { from, to }, note: notes.length > 0 ? notes.join(" ") : undefined };
}

function describe(
  clamped: { range: DateRange; note?: string },
  today: string,
  known: PresetKey | null,
): ResolvedRange {
  const { range, note } = clamped;
  const days = Math.round((ms(range.to) - ms(range.from)) / DAY) + 1;
  const preset = known ?? matchPreset(range, today);
  return { range, preset, days, ...(note ? { note } : {}) };
}

/** So a hand-typed range that happens to be "last 7 days" still lights up that chip. */
function matchPreset(range: DateRange, today: string): PresetKey | "custom" {
  for (const key of Object.keys(PRESET_LABELS) as PresetKey[]) {
    const candidate = presetRange(key, today);
    if (candidate.from === range.from && candidate.to === range.to) return key;
  }
  return "custom";
}

/** Every day in the window, for a trend with no gaps where nothing traded. */
export function eachDate(range: DateRange): string[] {
  const out: string[] = [];
  for (let at = ms(range.from); at <= ms(range.to); at += DAY) out.push(iso(at));
  return out;
}

/**
 * At what granularity a window should be charted. A bar per day is the point of a
 * two-week view and meaningless across a quarter, where a hundred slivers carry no
 * information and do not fit the chart besides.
 */
export const MAX_DAILY_BARS = 45;

export function granularityFor(days: number): "day" | "week" {
  return days > MAX_DAILY_BARS ? "week" : "day";
}

/**
 * Group dates into calendar weeks, Sunday-first to match the pay week. Each bucket
 * carries the dates it covers so the caller can total whatever it likes over them.
 */
export function weekBuckets(dates: readonly string[]): { start: string; dates: string[] }[] {
  const buckets: { start: string; dates: string[] }[] = [];
  for (const date of dates) {
    const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const start = iso(ms(date) - weekday * DAY);
    const last = buckets.at(-1);
    if (last && last.start === start) last.dates.push(date);
    else buckets.push({ start, dates: [date] });
  }
  return buckets;
}
