"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { countSuppliesBack } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";

const UNIT = { G: "g", ML: "ml", PC: "pcs" } as const;

const peso = (value: number | string) =>
  `₱${Number(value).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type LoadRow = {
  id: string;
  name: string;
  kind: "PRODUCT" | "SUPPLY";
  unit: string;
  issued: string;
  returned: string | null;
  wasted: string | null;
  sold: string | null;
  consumed: string | null;
  unitCost: string;
};

/**
 * Everything that went out on this cart today, sellable or not, in one list.
 *
 * Products are counted back through the closing grid; supplies are counted here. The
 * value column is what left the branch — for supplies that money is already inside the
 * products' cost, so it is shown for monitoring and never added to the shift.
 */
export function CartLoad({
  shiftId, rows, canCount,
}: {
  shiftId: string;
  rows: LoadRow[];
  canCount: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [returns, setReturns] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const products = rows.filter((r) => r.kind === "PRODUCT");
  const supplies = rows.filter((r) => r.kind === "SUPPLY");
  const uncounted = supplies.filter((s) => s.returned === null);

  const value = (row: LoadRow) => Number(row.issued) * Number(row.unitCost);
  const productValue = products.reduce((acc, r) => acc + value(r), 0);
  const supplyValue = supplies.reduce((acc, r) => acc + value(r), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Everything issued to this cart today</CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-right">Issued</th>
                <th className="px-3 py-2 text-right">Back</th>
                <th className="px-3 py-2 text-right">Used</th>
                <th className="px-3 py-2 text-right">Value out</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-stone-100">
              <tr className="bg-stone-50/60">
                <td colSpan={5} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Sellable products
                </td>
              </tr>
              {products.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2 font-medium text-stone-900">{row.name}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(row.issued).toLocaleString("en-PH")}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">
                    {row.returned === null ? "—" : Number(row.returned).toLocaleString("en-PH")}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {row.sold === null ? "—" : `${Number(row.sold).toLocaleString("en-PH")} sold`}
                    {row.wasted && Number(row.wasted) > 0 ? (
                      <span className="block text-xs text-red-700">{Number(row.wasted)} wasted</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{peso(value(row))}</td>
                </tr>
              ))}
              {products.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-2 text-stone-500">Nothing issued yet.</td></tr>
              ) : null}

              <tr className="bg-stone-50/60">
                <td colSpan={5} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  Supplies — not sold, cost already inside the products
                </td>
              </tr>
              {supplies.map((row) => (
                <tr key={row.id}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-stone-900">{row.name}</span>
                    <span className="ml-1 text-xs text-stone-500">({UNIT[row.unit as keyof typeof UNIT] ?? row.unit})</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{Number(row.issued).toLocaleString("en-PH")}</td>
                  <td className="px-3 py-2 text-right">
                    {row.returned === null && canCount ? (
                      <input
                        aria-label={`${row.name} returned`}
                        inputMode="numeric"
                        placeholder="0"
                        value={returns[row.id] ?? ""}
                        onChange={(event) =>
                          setReturns((prev) => ({ ...prev, [row.id]: event.target.value }))
                        }
                        className="h-11 w-24 rounded-md border border-stone-300 px-2 text-right font-mono tabular-nums"
                      />
                    ) : (
                      <span className="font-mono tabular-nums text-stone-500">
                        {row.returned === null ? "—" : Number(row.returned).toLocaleString("en-PH")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {row.consumed === null
                      ? returns[row.id]
                        ? `${(Number(row.issued) - Number(returns[row.id] || 0)).toLocaleString("en-PH")} used`
                        : "—"
                      : `${Number(row.consumed).toLocaleString("en-PH")} used`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-stone-500">{peso(value(row))}</td>
                </tr>
              ))}
              {supplies.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-2 text-stone-500">
                    No supplies issued. Use &ldquo;Issue supplies&rdquo; above to send out sauce, cups, bags and sticks.
                  </td>
                </tr>
              ) : null}
            </tbody>

            <tfoot className="border-t-2 border-stone-200 text-sm font-medium">
              <tr>
                <td className="px-3 py-2" colSpan={4}>Stock value sent out</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{peso(productValue + supplyValue)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="text-xs text-stone-500">
          Supplies are shown for monitoring only. Their cost already sits inside each product&apos;s
          cost per stick, so counting them here never changes the shift&apos;s profit — it tells you
          which carts get through more packaging than they should.
        </p>

        {message ? (
          <p className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
            {message.text}
          </p>
        ) : null}

        {canCount && uncounted.length > 0 ? (
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await countSuppliesBack(
                    shiftId,
                    uncounted.map((s) => ({ ingredientId: s.id, qtyReturned: returns[s.id] ?? "0" })),
                  );
                  setMessage({ ok: result.ok, text: result.ok ? result.message ?? "Counted." : result.error });
                  if (result.ok) router.refresh();
                })
              }
            >
              {pending ? "Counting…" : "Count supplies back"}
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
