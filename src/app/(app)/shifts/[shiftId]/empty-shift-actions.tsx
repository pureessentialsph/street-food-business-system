"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelShift, closeEmptyShift } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";

/**
 * A shift with nothing issued needs a way out, or a cart opened by mistake stays open
 * for ever and clutters the Daily Close board.
 */
export function EmptyShiftActions({ shiftId, cartCode }: { shiftId: string; cartCode: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [showClose, setShowClose] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, goToBoard: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error ?? "That did not work.");
        return;
      }
      if (goToBoard) router.push("/shifts");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50 p-4">
      <div>
        <p className="text-sm font-medium text-stone-800">Nothing has been issued yet</p>
        <p className="mt-1 text-sm text-stone-600">
          Enter the load-out above to start the day. If {cartCode} was opened by mistake, or it is
          not trading today, use one of these instead.
        </p>
      </div>

      {showClose ? (
        <div className="space-y-2">
          <label htmlFor="no-trade-reason" className="block text-sm font-medium text-stone-700">
            Why is the cart not trading?
          </label>
          <input
            id="no-trade-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. vendor absent, cart under repair, heavy rain"
            className="h-11 w-full rounded-md border border-stone-300 px-3 text-sm"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() => run(() => closeEmptyShift(shiftId, reason), false)}
            >
              {pending ? "Closing…" : "Close with no trade"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setShowClose(false)} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => setShowClose(true)} disabled={pending}>
            Close — cart did not trade
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Cancel today's shift for ${cartCode}? It goes back to "not opened". Nothing has been issued, so no stock is affected.`)) return;
              run(() => cancelShift(shiftId), true);
            }}
          >
            {pending ? "…" : "Cancel — opened by mistake"}
          </Button>
        </div>
      )}

      {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
    </div>
  );
}
