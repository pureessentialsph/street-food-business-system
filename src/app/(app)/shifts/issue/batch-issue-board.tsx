"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { issueStock, openShift } from "@/lib/actions/shifts";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";

type CartRow = {
  cartId: string;
  code: string;
  branch: string;
  location: string;
  shiftId: string | null;
  status: string | null;
  hasVendor: boolean;
  alreadyIssued: string;
  defaults: Record<string, string>;
};

type Product = { id: string; name: string; piecesPerStick: string; inSet: boolean };

/**
 * One screen, every cart. Each row opens the shift if needed and issues in one tap,
 * defaulting to what that cart usually takes — the supervisor repeats this eight to
 * twenty times a morning, so every saved tap compounds (spec §13).
 */
export function BatchIssueBoard({ carts, products }: { carts: CartRow[]; products: Product[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [quantities, setQuantities] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(carts.map((cart) => [cart.cartId, { ...cart.defaults }])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  // The five set products carry the incentive and go out every day, so they lead. Drinks,
  // fries and the rest are one tap away rather than crowding the grid.
  const [showOthers, setShowOthers] = useState<Record<string, boolean>>({});

  const setProducts = products.filter((p) => p.inSet);
  const otherProducts = products.filter((p) => !p.inSet);

  function setQty(cartId: string, productId: string, value: string) {
    setQuantities((prev) => ({ ...prev, [cartId]: { ...prev[cartId], [productId]: value } }));
  }

  function fillFromUsual(cart: CartRow) {
    setQuantities((prev) => ({ ...prev, [cart.cartId]: { ...cart.defaults } }));
  }

  function issueOne(cart: CartRow) {
    setBusy(cart.cartId);
    startTransition(async () => {
      let shiftId = cart.shiftId;
      if (!shiftId) {
        const opened = await openShift(cart.cartId, null);
        if (!opened.ok || !opened.id) {
          setResults((prev) => ({ ...prev, [cart.cartId]: { ok: false, text: opened.ok ? "Could not open" : opened.error } }));
          setBusy(null);
          return;
        }
        shiftId = opened.id;
      }

      const lines = products.map((product) => ({
        productId: product.id,
        qtyPieces: quantities[cart.cartId]?.[product.id] ?? "0",
      }));
      const result = await issueStock(shiftId, lines, "Morning load-out");
      setResults((prev) => ({
        ...prev,
        [cart.cartId]: { ok: result.ok, text: result.ok ? result.message ?? "Issued" : result.error },
      }));
      setBusy(null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {carts.map((cart) => {
        const row = quantities[cart.cartId] ?? {};
        const total = products.reduce((acc, p) => acc + (Number(row[p.id]) || 0), 0);
        const outcome = results[cart.cartId];
        const hasUsual = Object.keys(cart.defaults).length > 0;

        return (
          <Card key={cart.cartId}>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-stone-900">
                    {cart.code} <span className="font-normal text-stone-500">· {cart.branch} · {cart.location}</span>
                  </p>
                  <p className="text-xs text-stone-500">
                    {cart.status ? `shift ${cart.status.toLowerCase()}` : "not opened yet"}
                    {Number(cart.alreadyIssued) > 0 ? ` · ${cart.alreadyIssued} pcs already issued today` : ""}
                    {!cart.hasVendor ? " · no usual vendor — set one on the cart" : ""}
                  </p>
                </div>
                {hasUsual ? (
                  <button
                    type="button"
                    onClick={() => fillFromUsual(cart)}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    Same as usual
                  </button>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {(showOthers[cart.cartId] ? products : setProducts).map((product) => {
                  const value = row[product.id] ?? "";
                  const sticks = Number(value) / Number(product.piecesPerStick);
                  return (
                    <div key={product.id}>
                      <label
                        htmlFor={`q-${cart.cartId}-${product.id}`}
                        className="block truncate text-xs text-stone-600"
                        title={product.name}
                      >
                        {product.name}
                      </label>
                      <input
                        id={`q-${cart.cartId}-${product.id}`}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="0"
                        value={value}
                        onChange={(event) => setQty(cart.cartId, product.id, event.target.value)}
                        className="h-12 w-full rounded-md border border-stone-300 px-2 text-right font-mono text-base tabular-nums focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                      />
                      <span className="block text-right text-[11px] tabular-nums text-stone-400">
                        {value && Number(value) > 0 ? `${sticks.toFixed(0)} sticks` : " "}
                      </span>
                    </div>
                  );
                })}
              </div>

              {otherProducts.length > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    setShowOthers((prev) => ({ ...prev, [cart.cartId]: !prev[cart.cartId] }))
                  }
                  className="text-xs font-medium text-brand-700 hover:underline"
                >
                  {showOthers[cart.cartId]
                    ? "Show only set products"
                    : `+ ${otherProducts.length} more products (drinks, fries…)`}
                </button>
              ) : null}

              {outcome ? (
                <p className={`rounded-md px-3 py-2 text-sm ${outcome.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-800"}`}>
                  {outcome.text}
                </p>
              ) : null}

              <div className="flex items-center justify-between">
                <span className="text-sm text-stone-500">
                  {total > 0 ? `${total.toLocaleString("en-PH")} pieces` : "nothing entered"}
                </span>
                <Button
                  type="button"
                  disabled={pending || total <= 0 || busy === cart.cartId}
                  onClick={() => issueOne(cart)}
                >
                  {busy === cart.cartId ? "Issuing…" : cart.shiftId ? "Issue" : "Open & issue"}
                </Button>
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
