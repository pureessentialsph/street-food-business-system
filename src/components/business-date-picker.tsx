"use client";

import { useRouter } from "next/navigation";

/**
 * Move the Daily Close board to another day.
 *
 * The board only ever showed today, with the date reachable solely by typing a query
 * string — so a shift recorded for last Tuesday was invisible to the person who
 * recorded it. Going back is the normal case now that a past day can be written up.
 */
export function BusinessDatePicker({ value, max }: { value: string; max: string }) {
  const router = useRouter();
  const go = (date: string) => router.push(`/shifts?date=${date}`);
  const shift = (days: number) => {
    const d = new Date(`${value}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const iso = d.toISOString().slice(0, 10);
    if (iso <= max) go(iso);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => shift(-1)}
        aria-label="Previous day"
        className="h-11 rounded-md border border-stone-300 px-3 text-sm hover:bg-stone-50"
      >
        ←
      </button>
      <input
        type="date"
        aria-label="Business date"
        value={value}
        max={max}
        onChange={(event) => event.currentTarget.value && go(event.currentTarget.value)}
        className="h-11 rounded-md border border-stone-300 px-3 text-sm"
      />
      <button
        type="button"
        onClick={() => shift(1)}
        disabled={value >= max}
        aria-label="Next day"
        className="h-11 rounded-md border border-stone-300 px-3 text-sm hover:bg-stone-50 disabled:opacity-40"
      >
        →
      </button>
      {value !== max ? (
        <button
          type="button"
          onClick={() => go(max)}
          className="ml-1 text-xs font-medium text-brand-700 hover:underline"
        >
          today
        </button>
      ) : null}
    </div>
  );
}
