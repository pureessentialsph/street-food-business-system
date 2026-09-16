"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reopenShift } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";

/**
 * Correcting an approved shift. Not an edit — the approval is withdrawn and the reason
 * is kept permanently, because this moves money somebody already signed off.
 */
export function ReopenForm({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-sm font-medium text-stone-500 hover:text-red-700 hover:underline"
      >
        Reopen for correction
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
      <p className="text-sm font-medium text-red-900">Reopen this approved shift</p>
      <p className="text-xs text-red-800">
        The approval is withdrawn and the reason kept permanently. Re-counting then reverses
        the previous stock postings. If the vendor has already been paid, use a deduction on
        the next payroll instead.
      </p>
      <input
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why does this need correcting?"
        className="h-11 w-full rounded-md border border-red-300 px-3 text-sm"
      />
      {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={pending || reason.trim().length < 10}
          onClick={() =>
            startTransition(async () => {
              const result = await reopenShift(shiftId, reason);
              if (!result.ok) setError(result.error);
              else router.refresh();
            })
          }
        >
          {pending ? "Reopening…" : "Reopen"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
