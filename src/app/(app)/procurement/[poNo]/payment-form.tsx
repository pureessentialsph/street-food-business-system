"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markPurchaseOrderPaid } from "@/lib/actions/procurement";
import { Button } from "@/components/ui/button";

/**
 * How this order was settled.
 *
 * The question is how it was paid, never where the money came from: cash leaves the
 * box, everything else does not. If the box then shows less than it should, the money
 * came from somewhere that has not been recorded — which is a capital infusion to
 * enter on the Cash page, not a label to hang on a purchase.
 */
export function PaymentForm({
  poNo, total, paidAt, method,
}: {
  poNo: string;
  total: string;
  paidAt: string | null;
  method: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<"CASH" | "GCASH" | "BANK" | "CREDIT">(
    (method as "CASH" | "GCASH" | "BANK" | "CREDIT") ?? "CASH",
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {paidAt ? (
        <p className="text-sm text-stone-600">
          Paid {paidAt} by {(method ?? "").toLowerCase()}.
          {method === "CASH" ? " It came out of the cash box." : " The cash box was not touched."}
        </p>
      ) : (
        <p className="text-sm text-stone-600">
          Not recorded as paid yet. {total} is owed.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="How this order was paid"
          value={choice}
          onChange={(event) => setChoice(event.currentTarget.value as typeof choice)}
          className="h-11 rounded-md border border-stone-300 px-3 text-sm"
        >
          <option value="CASH">Cash — out of the cash box</option>
          <option value="GCASH">GCash</option>
          <option value="BANK">Bank transfer</option>
          <option value="CREDIT">On credit — not paid yet</option>
        </select>
        <Button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await markPurchaseOrderPaid(poNo, choice);
              if (!result.ok) setError(result.error);
              else router.refresh();
            })
          }
        >
          {pending ? "Recording…" : paidAt ? "Change how it was paid" : "Record payment"}
        </Button>
      </div>
      {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
    </div>
  );
}
