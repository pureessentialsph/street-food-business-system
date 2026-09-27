"use client";

import { useState } from "react";
import { Field, NumberInput, Select, TextInput } from "@/components/ui/field";

export type SuppliedItem = {
  ingredientId: string;
  purchaseUnitName: string;
  baseUnitsPerPurchaseUnit: string;
  lastPurchasePrice: string;
};

/**
 * The four fields describing one bought line, with the supplier's own pack details
 * filled in as soon as an ingredient is chosen.
 *
 * Those details already exist on the supplier's ingredient list — retyping "sack 25kg,
 * 25000, ₱1,500" for every delivery is both tedious and a place to fat-finger the pack
 * size, which would silently book the wrong quantity into stock. They stay editable
 * because a supplier can change pack or price at any time, and the price on the day is
 * what the costing should use.
 */
export function PoLineFields({
  ingredients, supplied,
}: {
  ingredients: { id: string; name: string; baseUnit: string }[];
  supplied: SuppliedItem[];
}) {
  const known = new Map(supplied.map((s) => [s.ingredientId, s]));
  const [unitName, setUnitName] = useState("");
  const [perUnit, setPerUnit] = useState("");
  const [price, setPrice] = useState("");
  const [chosen, setChosen] = useState("");

  const ingredient = ingredients.find((i) => i.id === chosen);
  const unitWord = ingredient
    ? ingredient.baseUnit === "G" ? "grams" : ingredient.baseUnit === "ML" ? "ml" : "pieces"
    : "base units";

  return (
    <>
      <Field label="What you bought" name="ingredientId" required>
        <Select
          id="ingredientId"
          name="ingredientId"
          required
          value={chosen}
          onChange={(event) => {
            const id = event.currentTarget.value;
            setChosen(id);
            const match = known.get(id);
            setUnitName(match?.purchaseUnitName ?? "");
            setPerUnit(match?.baseUnitsPerPurchaseUnit ?? "");
            setPrice(match?.lastPurchasePrice ?? "");
          }}
        >
          <option value="">— select —</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
              {known.has(i.id) ? "" : " (not on this supplier's list)"}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="How many" name="qtyPurchaseUnit" required hint="Packs, sacks or trays — not grams.">
        <NumberInput id="qtyPurchaseUnit" name="qtyPurchaseUnit" required placeholder="0" />
      </Field>

      <Field label="Sold as" name="purchaseUnitName" required hint="e.g. sack 25kg, tray 30pcs">
        <TextInput
          id="purchaseUnitName"
          name="purchaseUnitName"
          required
          value={unitName}
          onChange={(event) => setUnitName(event.currentTarget.value)}
        />
      </Field>

      <Field
        label={`${unitWord[0]!.toUpperCase()}${unitWord.slice(1)} per pack`}
        name="baseUnitsPerPurchaseUnit"
        required
        hint={`How many ${unitWord} one pack holds — 25,000 for a 25 kg sack.`}
      >
        <NumberInput
          id="baseUnitsPerPurchaseUnit"
          name="baseUnitsPerPurchaseUnit"
          required
          placeholder="1"
          value={perUnit}
          onChange={(event) => setPerUnit(event.currentTarget.value)}
        />
      </Field>

      <Field label="Price per pack (₱)" name="unitPrice" required hint="What you actually paid today.">
        <NumberInput
          id="unitPrice"
          name="unitPrice"
          required
          placeholder="0.00"
          value={price}
          onChange={(event) => setPrice(event.currentTarget.value)}
        />
      </Field>
    </>
  );
}
