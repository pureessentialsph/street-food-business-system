"use client";

import { useState } from "react";
import { Select, TextInput } from "@/components/ui/field";

export type ComboOption = { value: string; label: string };

/**
 * Pick from what already exists, or type something new — the pattern the job-title
 * field established, made reusable.
 *
 * Two fields, not one, because the two cases mean different things. Choosing sends an
 * id under `name`; typing sends a plain name under `newName`, and the server decides
 * whether that means "create it" or "match an existing one". Squeezing both down one
 * field would leave the action guessing whether a string is an id or a name.
 */
export function ComboSelect({
  name, newName, options, defaultValue = "", placeholder, addLabel, emptyLabel = "— select —", required = false,
}: {
  /** Field carrying the chosen option's value. */
  name: string;
  /** Field carrying a newly typed name instead. */
  newName: string;
  options: ComboOption[];
  defaultValue?: string;
  placeholder?: string;
  addLabel: string;
  emptyLabel?: string;
  required?: boolean;
}) {
  const [adding, setAdding] = useState(options.length === 0);

  if (adding) {
    return (
      <div className="space-y-1">
        <TextInput
          id={name}
          name={newName}
          placeholder={placeholder}
          autoFocus
          required={required && options.length === 0}
        />
        {options.length > 0 ? (
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
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        onChange={(event) => {
          if (event.currentTarget.value === "__new__") setAdding(true);
        }}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
        <option value="__new__">{addLabel}…</option>
      </Select>
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="text-xs font-medium text-brand-700 hover:underline"
      >
        {addLabel}
      </button>
    </div>
  );
}
