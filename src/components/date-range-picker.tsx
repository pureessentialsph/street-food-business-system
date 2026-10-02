"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PRESET_LABELS, type PresetKey } from "@/lib/engines/date-range";

/**
 * Choose the window the figures cover.
 *
 * The range lives in the URL rather than in component state, so a period an owner wants
 * to show somebody survives a refresh and can be sent as a link — and so the page stays
 * a server component that reads from the database once.
 */
export function DateRangePicker({
  basePath, from, to, preset, max,
}: {
  basePath: string;
  from: string;
  to: string;
  /** "custom" when the dates were typed rather than picked. */
  preset: PresetKey | "custom";
  /** The business date; later than this there is nothing to show. */
  max: string;
}) {
  const router = useRouter();
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);

  const goPreset = (key: PresetKey) => router.push(`${basePath}?preset=${key}`);
  const goDates = (nextFrom: string, nextTo: string) =>
    router.push(`${basePath}?from=${nextFrom}&to=${nextTo}`);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1" role="group" aria-label="Date range presets">
        {(Object.keys(PRESET_LABELS) as PresetKey[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={preset === key}
            onClick={() => goPreset(key)}
            className={`h-9 rounded-md border px-3 text-xs font-medium ${
              preset === key
                ? "border-brand-600 bg-brand-50 text-brand-800"
                : "border-stone-300 text-stone-600 hover:bg-stone-50"
            }`}
          >
            {PRESET_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <input
          type="date"
          aria-label="From"
          value={draftFrom}
          max={max}
          onChange={(event) => {
            setDraftFrom(event.currentTarget.value);
            if (event.currentTarget.value) goDates(event.currentTarget.value, draftTo);
          }}
          className="h-9 rounded-md border border-stone-300 px-2 text-xs"
        />
        <span className="text-xs text-stone-400">to</span>
        <input
          type="date"
          aria-label="To"
          value={draftTo}
          max={max}
          onChange={(event) => {
            setDraftTo(event.currentTarget.value);
            if (event.currentTarget.value) goDates(draftFrom, event.currentTarget.value);
          }}
          className="h-9 rounded-md border border-stone-300 px-2 text-xs"
        />
      </div>
    </div>
  );
}
