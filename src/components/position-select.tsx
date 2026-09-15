"use client";

import { useState } from "react";
import { Select, TextInput } from "@/components/ui/field";

/**
 * Pick a job title from the ones already in use, or type a new one. A new title is
 * saved on submit and offered in this list from then on, so the business's own
 * vocabulary accumulates instead of being hardcoded.
 */
export function PositionSelect({
  positions, defaultValue = "",
}: {
  positions: string[];
  defaultValue?: string;
}) {
  // An existing employee whose title is no longer in the list still edits cleanly.
  const known = defaultValue && !positions.includes(defaultValue)
    ? [defaultValue, ...positions]
    : positions;

  const [adding, setAdding] = useState(known.length === 0);

  if (adding) {
    return (
      <div className="space-y-1">
        <TextInput
          id="position"
          name="position"
          defaultValue={defaultValue}
          placeholder="e.g. Motor Cart Driver"
          autoFocus
          required
        />
        {known.length > 0 ? (
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            ← Choose from the existing list instead
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Select
        id="position"
        name="position"
        defaultValue={defaultValue}
        required
        onChange={(event) => {
          if (event.currentTarget.value === "__new__") setAdding(true);
        }}
      >
        <option value="">— select —</option>
        {known.map((position) => (
          <option key={position} value={position}>{position}</option>
        ))}
        <option value="__new__">+ Add a new position…</option>
      </Select>
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="text-xs font-medium text-brand-700 hover:underline"
      >
        + Add a new position
      </button>
    </div>
  );
}
