"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setShiftVendors } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";

/**
 * Who worked the cart. Shown on every shift because a second vendor was otherwise
 * invisible here, and editable because the usual vendor is filled in by one click —
 * the wrong name is an easy mistake and every name on this list earns a day's pay.
 */
export function VendorRosterForm({
  shiftId, roster, employees, canEdit, locked,
}: {
  shiftId: string;
  /** In order: the first is answerable for the cash. */
  roster: { id: string; name: string }[];
  employees: { id: string; name: string; hasScheme: boolean }[];
  canEdit: boolean;
  /** Approved shifts are immutable; say so rather than offering a button that refuses. */
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [primary, setPrimary] = useState(roster[0]?.id ?? "");
  const [second, setSecond] = useState(roster[1]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const names = roster.length > 0
    ? roster.map((v, index) => `${v.name}${index === 0 && roster.length > 1 ? " (cash)" : ""}`).join(", ")
    : "nobody recorded";

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-stone-500">Worked by</span>
        <span className="font-medium text-stone-900">{names}</span>
        {canEdit && !locked ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            change
          </button>
        ) : null}
        {locked ? <span className="text-xs text-stone-500">locked by approval</span> : null}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-3">
      <p className="text-sm font-medium text-stone-900">Who worked this cart?</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Vendor answerable for the cash"
          className="h-11 rounded-md border border-stone-300 px-3 text-sm"
          value={primary}
          onChange={(event) => setPrimary(event.currentTarget.value)}
        >
          <option value="">Vendor…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}{e.hasScheme ? "" : " — no pay scheme"}</option>
          ))}
        </select>
        <select
          aria-label="Second vendor"
          className="h-11 rounded-md border border-stone-300 px-3 text-sm"
          value={second}
          onChange={(event) => setSecond(event.currentTarget.value)}
        >
          <option value="">+ second vendor (optional)</option>
          {employees.filter((e) => e.id !== primary).map((e) => (
            <option key={e.id} value={e.id}>{e.name}{e.hasScheme ? "" : " — no pay scheme"}</option>
          ))}
        </select>
      </div>
      <p className="text-xs text-stone-500">
        The first name is answerable for the cash. Both earn their daily rate, and both earn
        the set incentive if the day meets it — so changing this changes the day&rsquo;s pay,
        which is recalculated when you save.
      </p>
      {error ? <p role="alert" className="text-sm font-medium text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pending || !primary}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await setShiftVendors(shiftId, second ? [primary, second] : [primary]);
              if (!result.ok) setError(result.error);
              else {
                setEditing(false);
                router.refresh();
              }
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
