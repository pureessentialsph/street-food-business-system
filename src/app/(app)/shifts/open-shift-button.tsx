"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { openShift } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";

/** Opens a cart for today, asking for a vendor only when the cart has no usual one. */
export function OpenShiftButton({
  cartId, cartCode, hasDefaultVendor, vendors,
}: {
  cartId: string;
  cartCode: string;
  hasDefaultVendor: boolean;
  vendors: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open(employeeId: string | null) {
    setError(null);
    startTransition(async () => {
      const result = await openShift(cartId, employeeId);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  if (picking || !hasDefaultVendor) {
    return (
      <div className="flex items-center gap-2">
        <select
          aria-label={`Vendor for ${cartCode}`}
          className="h-11 rounded-md border border-stone-300 px-3 text-sm"
          defaultValue=""
          onChange={(event) => event.currentTarget.value && open(event.currentTarget.value)}
        >
          <option value="">Pick vendor…</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
          ))}
        </select>
        {error ? <span className="text-xs font-medium text-red-700">{error}</span> : null}
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
        onClick={() => setPicking(true)}
        className="text-xs font-medium text-brand-700 hover:underline"
      >
        different vendor
      </button>
      {error ? <span className="text-xs font-medium text-red-700">{error}</span> : null}
    </>
  );
}
