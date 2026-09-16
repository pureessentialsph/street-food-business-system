"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createPurchaseOrder } from "@/lib/actions/procurement";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

type Item = {
  itemId: string;
  itemName: string;
  suggestedQty: string;
  purchaseUnitName: string;
  baseUnitsPerPurchaseUnit: string;
  lastPurchasePrice: string;
};

const peso = (value: number) =>
  `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One supplier, one destination, one order. Quantities pre-filled but always editable. */
export function OrderBuilder({
  supplierId, supplierName, branchId, branchName, items,
}: {
  supplierId: string;
  supplierName: string;
  branchId: string;
  branchName: string;
  items: Item[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, string>>(
    () => Object.fromEntries(items.map((i) => [i.itemId, i.suggestedQty])),
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const total = items.reduce((acc, item) => {
    const base = Number(quantities[item.itemId] ?? 0);
    const packs = base / Number(item.baseUnitsPerPurchaseUnit || 1);
    return acc + packs * Number(item.lastPurchasePrice);
  }, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Order from {supplierName}{" "}
          <span className="font-normal text-stone-500">→ {branchName}</span>
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Order (base units)</th>
                <th className="px-3 py-2 text-left">= packs</th>
                <th className="px-3 py-2 text-right">Line cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {items.map((item) => {
                const base = Number(quantities[item.itemId] ?? 0);
                const per = Number(item.baseUnitsPerPurchaseUnit || 1);
                const packs = base / per;
                return (
                  <tr key={item.itemId}>
                    <td className="px-3 py-2 font-medium text-stone-900">{item.itemName}</td>
                    <td className="px-3 py-2 text-right">
                      <input
                        aria-label={`Order quantity for ${item.itemName}`}
                        inputMode="numeric"
                        value={quantities[item.itemId] ?? ""}
                        onChange={(event) =>
                          setQuantities((prev) => ({ ...prev, [item.itemId]: event.target.value }))
                        }
                        className="h-11 w-28 rounded-md border border-stone-300 px-2 text-right font-mono tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2 text-stone-600">
                      {packs.toFixed(2)} × {item.purchaseUnitName}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {peso(packs * Number(item.lastPurchasePrice))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-stone-200 font-medium">
              <tr>
                <td colSpan={3} className="px-3 py-2">Order total</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{peso(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {message ? (
          <p className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
            {message.text}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={pending || total <= 0}
            onClick={() =>
              startTransition(async () => {
                const formData = new FormData();
                formData.set("supplierId", supplierId);
                formData.set("destinationBranchId", branchId);
                for (const item of items) {
                  formData.set(`qty-${item.itemId}`, quantities[item.itemId] ?? "0");
                }
                const result = await createPurchaseOrder(formData);
                setMessage({ ok: result.ok, text: result.ok ? result.message ?? "Raised." : result.error });
                if (result.ok) router.refresh();
              })
            }
          >
            {pending ? "Raising…" : "Raise purchase order"}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
