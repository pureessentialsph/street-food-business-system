"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { receiveTransfer } from "@/lib/actions/inventory";
import { Button } from "@/components/ui/button";

/**
 * Receiving is counted, not assumed: each line defaults to what was sent, and any
 * shortfall is written off as an adjustment so the loss is visible.
 */
export function ReceiveTransferForm({
  transferId, lines,
}: {
  transferId: string;
  lines: { id: string; name: string; qtySent: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="rounded-md border border-amber-200 bg-amber-50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await receiveTransfer(transferId, formData);
          if (!result.ok) setError(result.error);
          else router.refresh();
        });
      }}
    >
      <p className="mb-3 text-sm font-medium text-amber-900">
        Count what actually arrived. Anything short is written off, not quietly absorbed.
      </p>
      <div className="space-y-2">
        {lines.map((line) => (
          <div key={line.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`received-${line.id}`} className="text-sm text-stone-800">
              {line.name} <span className="text-stone-500">· {line.qtySent} sent</span>
            </label>
            <input
              id={`received-${line.id}`}
              name={`received-${line.id}`}
              inputMode="decimal"
              defaultValue={line.qtySent}
              className="h-11 w-28 rounded-md border border-stone-300 px-3 text-right font-mono tabular-nums"
            />
          </div>
        ))}
      </div>
      {error ? <p role="alert" className="mt-2 text-sm font-medium text-red-700">{error}</p> : null}
      <div className="mt-3 flex justify-end">
        <Button type="submit" disabled={pending}>{pending ? "Receiving…" : "Receive stock"}</Button>
      </div>
    </form>
  );
}
