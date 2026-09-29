"use client";

import { useState } from "react";
import { formatSticks, piecesToSticks } from "@/lib/units";
import { Field, NumberInput, Select } from "@/components/ui/field";

export type ProducibleProduct = { id: string; name: string; piecesPerStick: string };

/**
 * Product and quantities for a production batch, with the stick equivalent shown as
 * you type.
 *
 * A batch is entered in pieces because that is what the commissary makes — a stick
 * only exists once a vendor skewers it at the cart. But the owner thinks in sticks, and
 * "2,000 pieces" is a place to slip a decimal without noticing. Showing both is the
 * cheapest possible check on the number.
 *
 * The conversion goes through piecesToSticks like every other one in the codebase; an
 * inline divide here would be exactly the drift units.ts exists to prevent.
 */
export function ProductionQuantities({ products }: { products: ProducibleProduct[] }) {
  const [productId, setProductId] = useState("");
  const [produced, setProduced] = useState("");
  const [wasted, setWasted] = useState("");

  const product = products.find((p) => p.id === productId);

  const sticks = (value: string): string | null => {
    if (!product || value.trim() === "") return null;
    const pieces = Number(value);
    if (!Number.isFinite(pieces) || pieces < 0) return null;
    return formatSticks(piecesToSticks(value, product.piecesPerStick));
  };

  const producedSticks = sticks(produced);
  const wastedSticks = sticks(wasted);

  return (
    <>
      <Field
        label="Product"
        name="productId"
        required
        hint={product ? `${product.piecesPerStick} pieces make one stick.` : undefined}
      >
        <Select
          id="productId"
          name="productId"
          required
          value={productId}
          onChange={(event) => setProductId(event.currentTarget.value)}
        >
          <option value="">— select —</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </Field>

      <Field
        label="Pieces produced"
        name="actualQty"
        required
        hint={producedSticks ? `= ${producedSticks}` : "Good pieces that went into stock."}
      >
        <NumberInput
          id="actualQty"
          name="actualQty"
          required
          placeholder="0"
          value={produced}
          onChange={(event) => setProduced(event.currentTarget.value)}
        />
      </Field>

      <Field
        label="Pieces wasted"
        name="wasteQty"
        required
        hint={
          wastedSticks
            ? `= ${wastedSticks}. Costed, then written off.`
            : "Burnt, dropped or spoiled during production. Costed, then written off."
        }
      >
        <NumberInput
          id="wasteQty"
          name="wasteQty"
          required
          placeholder="0"
          value={wasted}
          onChange={(event) => setWasted(event.currentTarget.value)}
        />
      </Field>
    </>
  );
}
