"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { issueStock } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";

/**
 * Issuing stock. Quantities are PIECES; the stick equivalent is shown live beside each
 * input so nobody has to divide by 3, 4, 5 or 10 in their head (spec §13).
 */
export function IssueForm({
  shiftId, products, isRefill,
}: {
  shiftId: string;
  isRefill: boolean;
  products: { id: string; name: string; piecesPerStick: string; alreadyIssued: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const total = Object.values(quantities).reduce((acc, v) => acc + (Number(v) || 0), 0);

  function submit() {
    setMessage(null);
    startTransition(async () => {
      const result = await issueStock(
        shiftId,
        products.map((p) => ({ productId: p.id, qtyPieces: quantities[p.id] ?? "0" })),
        isRefill ? "Refill" : "Morning load-out",
      );
      setMessage({ ok: result.ok, text: result.ok ? result.message ?? "Issued." : result.error });
      if (result.ok) {
        setQuantities({});
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {products.map((product) => {
          const value = quantities[product.id] ?? "";
          const sticks = Number(value) / Number(product.piecesPerStick);
          return (
            <div key={product.id} className="flex items-center justify-between gap-3">
              <label htmlFor={`issue-${product.id}`} className="min-w-0 flex-1 text-sm">
                <span className="font-medium text-stone-900">{product.name}</span>
                <span className="block text-xs text-stone-500">
                  {product.piecesPerStick} pcs/stick
                  {Number(product.alreadyIssued) > 0 ? ` · ${product.alreadyIssued} already issued` : ""}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id={`issue-${product.id}`}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="0"
                  value={value}
                  onChange={(event) =>
                    setQuantities((prev) => ({ ...prev, [product.id]: event.target.value }))
                  }
                  className="h-12 w-24 rounded-md border border-stone-300 px-3 text-right font-mono text-lg tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
                <span className="w-20 text-right text-xs tabular-nums text-stone-500">
                  {value && Number(value) > 0 ? `${sticks.toFixed(1)} sticks` : ""}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {message ? (
        <p
          role="alert"
          className={`rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <span className="text-sm text-stone-500">{total > 0 ? `${total.toLocaleString("en-PH")} pieces` : "Nothing entered yet"}</span>
        <Button type="button" size="lg" disabled={pending || total <= 0} onClick={submit}>
          {pending ? "Issuing…" : isRefill ? "Issue refill" : "Issue load-out"}
        </Button>
      </div>
    </div>
  );
}
