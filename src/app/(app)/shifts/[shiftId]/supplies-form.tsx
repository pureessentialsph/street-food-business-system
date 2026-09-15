"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { issueSupplies } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";

const UNIT = { G: "g", ML: "ml", PC: "pcs" } as const;

/**
 * Sauce, cups, bags, sticks and oil sent out with the cart. Tracked as stock so you can
 * see where they went, but never charged to the shift — they are already inside each
 * product's per-stick cost.
 */
export function SuppliesForm({
  shiftId, supplies,
}: {
  shiftId: string;
  supplies: { id: string; name: string; baseUnit: keyof typeof UNIT; onHand: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const total = Object.values(quantities).filter((v) => Number(v) > 0).length;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-brand-700 hover:underline"
      >
        + Issue supplies (sauce, cups, bags, sticks)
      </button>
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-stone-200 p-3">
      <div>
        <p className="text-sm font-medium text-stone-800">Cart supplies</p>
        <p className="text-xs text-stone-500">
          Moves stock so you can see where it went. Not charged to the shift — sauce, cups and
          sticks are already inside each product&apos;s cost per stick.
        </p>
      </div>

      <div className="space-y-2">
        {supplies.map((supply) => (
          <div key={supply.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`supply-${supply.id}`} className="min-w-0 flex-1 text-sm">
              <span className="font-medium text-stone-900">{supply.name}</span>
              <span className="block text-xs text-stone-500">
                {Number(supply.onHand).toLocaleString("en-PH")} {UNIT[supply.baseUnit]} at the branch
              </span>
            </label>
            <input
              id={`supply-${supply.id}`}
              inputMode="numeric"
              placeholder="0"
              value={quantities[supply.id] ?? ""}
              onChange={(event) =>
                setQuantities((prev) => ({ ...prev, [supply.id]: event.target.value }))
              }
              className="h-12 w-24 rounded-md border border-stone-300 px-3 text-right font-mono text-base tabular-nums"
            />
          </div>
        ))}
      </div>

      {message ? (
        <p className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
          {message.text}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-stone-500 hover:underline">
          Hide
        </button>
        <Button
          type="button"
          disabled={pending || total === 0}
          onClick={() =>
            startTransition(async () => {
              const result = await issueSupplies(
                shiftId,
                supplies.map((s) => ({ ingredientId: s.id, qty: quantities[s.id] ?? "0" })),
              );
              setMessage({ ok: result.ok, text: result.ok ? result.message ?? "Issued." : result.error });
              if (result.ok) {
                setQuantities({});
                router.refresh();
              }
            })
          }
        >
          {pending ? "Issuing…" : "Issue supplies"}
        </Button>
      </div>
    </div>
  );
}
