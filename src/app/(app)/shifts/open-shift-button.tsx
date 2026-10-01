"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openShift } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";

/**
 * Opens a cart. Usually one click for today with the cart's usual vendor; the panel
 * handles the two cases that used to need a developer — a second vendor sharing the
 * cart, and a day that was missed and is being written up afterwards.
 */
export function OpenShiftButton({
  cartId, cartCode, hasDefaultVendor, vendors, canBackdate, today,
}: {
  cartId: string;
  cartCode: string;
  hasDefaultVendor: boolean;
  vendors: { id: string; name: string }[];
  /** Backdating is an owner's decision; see openShift. */
  canBackdate: boolean;
  today: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [panel, setPanel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [primary, setPrimary] = useState("");
  const [second, setSecond] = useState("");
  const [forDate, setForDate] = useState(today);

  function open(employeeId: string | null, extras: string[] = [], date?: string) {
    setError(null);
    startTransition(async () => {
      const result = await openShift(cartId, employeeId, {
        extraVendorIds: extras,
        forDate: date && date !== today ? date : undefined,
      });
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  if (panel || !hasDefaultVendor) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={`Vendor for ${cartCode}`}
            className="h-11 rounded-md border border-stone-300 px-3 text-sm"
            value={primary}
            onChange={(event) => setPrimary(event.currentTarget.value)}
          >
            <option value="">Vendor…</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>

          <select
            aria-label={`Second vendor for ${cartCode}`}
            className="h-11 rounded-md border border-stone-300 px-3 text-sm"
            value={second}
            onChange={(event) => setSecond(event.currentTarget.value)}
          >
            <option value="">+ second vendor (optional)</option>
            {vendors.filter((v) => v.id !== primary).map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>

          {canBackdate ? (
            <input
              type="date"
              aria-label={`Business date for ${cartCode}`}
              max={today}
              value={forDate}
              onChange={(event) => setForDate(event.currentTarget.value)}
              className="h-11 rounded-md border border-stone-300 px-3 text-sm"
            />
          ) : null}

          <Button
            type="button"
            disabled={pending || !primary}
            onClick={() => open(primary, second ? [second] : [], forDate)}
          >
            {pending ? "Opening…" : "Open"}
          </Button>
        </div>

        {canBackdate && forDate !== today ? (
          <p className="text-xs font-medium text-amber-800">
            Recording {forDate}, a day that has already passed. The shift is stamped with your
            name and today&rsquo;s date so it is never mistaken for one closed on the night.
          </p>
        ) : null}
        {second ? (
          <p className="text-xs text-stone-500">
            Both vendors earn their daily rate, and both earn the set incentive if the day meets
            it. The first name is answerable for the cash.
          </p>
        ) : null}
        {error ? <p className="text-xs font-medium text-red-700">{error}</p> : null}
      </div>
    );
  }

  return (
    <>
      <Button type="button" disabled={pending} onClick={() => open(null)}>
        {pending ? "Opening…" : "Open"}
      </Button>
      <button
        type="button"
        onClick={() => setPanel(true)}
        className="text-xs font-medium text-brand-700 hover:underline"
      >
        other vendor, or a past day
      </button>
      {error ? <span className="text-xs font-medium text-red-700">{error}</span> : null}
    </>
  );
}
