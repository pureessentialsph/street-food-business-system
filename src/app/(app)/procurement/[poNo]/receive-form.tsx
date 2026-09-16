"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { receivePurchaseOrder } from "@/lib/actions/procurement";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Receiving. Both the quantity and the price are counted, because the price on the
 * delivery note is frequently not the price on the order — and that difference is
 * exactly what should flow into product costs.
 */
export function ReceiveForm({
  poNo, reference, lines,
}: {
  poNo: string;
  reference: string;
  lines: {
    id: string; name: string; qtyPurchaseUnit: string; purchaseUnitName: string;
    unitPrice: string; baseUnitsPerPurchaseUnit: string;
  }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <Card>
      <CardHeader><CardTitle>Receive {reference}</CardTitle></CardHeader>
      <CardBody>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await receivePurchaseOrder(poNo, formData);
              setMessage({ ok: result.ok, text: result.ok ? result.message ?? "Received." : result.error });
              if (result.ok) router.refresh();
            });
          }}
        >
          <p className="text-sm text-stone-600">
            Count what arrived and check the price on the delivery note. A different price updates
            the ingredient cost and every product that uses it.
          </p>

          <div className="space-y-2">
            {lines.map((line) => (
              <div key={line.id} className="flex flex-wrap items-end justify-between gap-3 rounded-md border border-stone-200 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-900">{line.name}</p>
                  <p className="text-xs text-stone-500">
                    ordered {line.qtyPurchaseUnit} × {line.purchaseUnitName} ({line.baseUnitsPerPurchaseUnit} base units each)
                  </p>
                </div>
                <div className="flex gap-2">
                  <label className="text-xs text-stone-600">
                    <span className="mb-1 block">Received ({line.purchaseUnitName})</span>
                    <input
                      name={`received-${line.id}`}
                      inputMode="decimal"
                      defaultValue={line.qtyPurchaseUnit}
                      className="h-11 w-28 rounded-md border border-stone-300 px-2 text-right font-mono tabular-nums"
                    />
                  </label>
                  <label className="text-xs text-stone-600">
                    <span className="mb-1 block">Price charged (₱)</span>
                    <input
                      name={`price-${line.id}`}
                      inputMode="decimal"
                      defaultValue={line.unitPrice}
                      className="h-11 w-28 rounded-md border border-stone-300 px-2 text-right font-mono tabular-nums"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-stone-700">Note</span>
            <input
              name="note"
              placeholder="e.g. one sack torn, credited"
              className="h-11 w-full rounded-md border border-stone-300 px-3 text-sm"
            />
          </label>

          {message ? (
            <p className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
              {message.text}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>{pending ? "Receiving…" : "Receive stock"}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
