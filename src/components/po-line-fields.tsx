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
 *
 * Something bought for the first time can be typed instead of chosen. Two more fields
 * appear, because an ingredient cannot be counted without knowing whether it is grams,
 * millilitres or pieces — everything else, including what it costs per unit, follows
 * from the purchase itself.
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
  const [adding, setAdding] = useState(false);

  const ingredient = ingredients.find((i) => i.id === chosen);
  const unitWord = ingredient
    ? ingredient.baseUnit === "G" ? "grams" : ingredient.baseUnit === "ML" ? "ml" : "pieces"
    : "units";

  return (
    <>
      <Field
        label="What you bought"
        name="ingredientId"
        required
        hint={adding ? "A new item. Its cost per unit is worked out from this purchase." : undefined}
      >
        {adding ? (
          <div className="space-y-1">
            <TextInput
              id="ingredientId"
              name="ingredientName"
              placeholder="e.g. Chilli garlic sauce"
              autoFocus
              required
            />
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              ← Choose from the existing list instead
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            <Select
              id="ingredientId"
              name="ingredientId"
              required
              value={chosen}
              onChange={(event) => {
                const id = event.currentTarget.value;
                if (id === "__new__") {
                  setAdding(true);
                  setChosen("");
                  setUnitName("");
                  setPerUnit("");
                  setPrice("");
                  return;
                }
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
              <option value="__new__">+ Something not on the list…</option>
            </Select>
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-xs font-medium text-brand-700 hover:underline"
            >
              + Something not on the list
            </button>
          </div>
        )}
      </Field>

      {adding ? (
        <>
          <Field
            label="Measured in"
            name="newBaseUnit"
            required
            hint="How you will count it in stock. Cannot be changed later, so pick the way you actually count."
          >
            <Select id="newBaseUnit" name="newBaseUnit" required defaultValue="">
              <option value="">— select —</option>
              <option value="G">Grams</option>
              <option value="ML">Millilitres</option>
              <option value="PC">Pieces</option>
            </Select>
          </Field>
          <Field label="Kind" name="newCategory" hint="Only used for grouping.">
            <Select id="newCategory" name="newCategory" defaultValue="RAW">
              <option value="RAW">Raw ingredient</option>
              <option value="CONDIMENT">Condiment / sauce</option>
              <option value="OIL">Oil</option>
              <option value="PACKAGING">Packaging</option>
              <option value="CONSUMABLE">Consumable</option>
            </Select>
          </Field>
        </>
      ) : null}

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
