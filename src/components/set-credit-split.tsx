"use client";

import { useState } from "react";
import { EntityForm } from "@/components/entity-form";
import { NumberInput } from "@/components/ui/field";
import type { ActionResult } from "@/lib/actions/errors";

export type CreditRow = {
  id: string;
  productName: string;
  requiredSticks: string;
  /** "" means the component has no value of its own and takes an equal share. */
  creditValue: string;
};

const peso = (value: number) =>
  `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The credit split for one set, edited as a whole.
 *
 * The running total is the point of this screen. A split is written product by product
 * but judged as a sum — the owner wants to know that the five components still add up
 * to what a full set is supposed to pay — and checking that by hand across five boxes
 * is exactly the arithmetic a computer should be doing.
 */
export function SetCreditSplit({
  rows, incentiveAmount, equalShare, action,
}: {
  rows: CreditRow[];
  incentiveAmount: number;
  equalShare: number;
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(rows.map((row) => [row.id, row.creditValue])),
  );

  // A blank box is not zero — it means "take an equal share" — so it contributes the
  // equal share to the total, exactly as payroll would compute it.
  const effective = (raw: string) => {
    if (raw.trim() === "") return equalShare;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };

  const total = rows.reduce((running, row) => running + effective(values[row.id] ?? ""), 0);
  const difference = total - incentiveAmount;
  const matches = Math.abs(difference) < 0.005;

  return (
    <EntityForm action={action} returnTo="/sets" submitLabel="Save credit split" compact>
      <div className="space-y-2">
        {rows.map((row) => {
          const raw = values[row.id] ?? "";
          const usingShare = raw.trim() === "";
          return (
            <div key={row.id} className="flex flex-wrap items-center gap-3">
              <label htmlFor={`credit-${row.id}`} className="min-w-[10rem] flex-1 text-sm">
                <span className="font-medium text-stone-800">{row.productName}</span>{" "}
                <span className="text-stone-500">· {row.requiredSticks} sticks</span>
              </label>
              <div className="w-40">
                <NumberInput
                  id={`credit-${row.id}`}
                  name={`credit-${row.id}`}
                  value={raw}
                  placeholder={equalShare.toFixed(2)}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [row.id]: event.target.value }))
                  }
                />
              </div>
              <span className="w-32 text-xs text-stone-500">
                {usingShare ? "equal share" : `${peso(effective(raw))} per credit`}
              </span>
            </div>
          );
        })}
      </div>

      <div
        className={
          matches
            ? "rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-700"
            : "rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
        }
      >
        <span className="font-medium">Components total {peso(total)}</span>{" "}
        {matches ? (
          <>— matches the {peso(incentiveAmount)} a full set pays.</>
        ) : (
          <>
            — a full set pays {peso(incentiveAmount)}, so the split is{" "}
            {peso(Math.abs(difference))} {difference > 0 ? "over" : "under"}. That is allowed:
            a vendor who sells every component earns the total above, not the set figure.
          </>
        )}
      </div>

      <p className="text-xs text-stone-500">
        Leave a box blank to give that product an equal share ({peso(equalShare)}). Enter 0 to
        make it earn no incentive at all.
      </p>
    </EntityForm>
  );
}
