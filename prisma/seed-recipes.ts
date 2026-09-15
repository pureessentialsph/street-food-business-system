/**
 * Recipes for the five core products (spec §12 Phase 2).
 *
 * Quantities are per BATCH unless the line says otherwise, and every cost comes from
 * the ingredient master, so changing a price in the UI moves these products' costs.
 * The figures are realistic but illustrative — the owner adjusts them against real
 * yields once the kitchen weighs a batch.
 */
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;

type Line = {
  sku: string;
  qty: string;
  basis: "PER_BATCH" | "PER_PIECE" | "PER_STICK";
  type: "RAW" | "PACKAGING" | "CONDIMENT" | "OIL" | "CONSUMABLE";
  wastage?: string;
};

const RECIPES: { product: string; batch: string; notes: string; lines: Line[] }[] = [
  {
    product: "KWEK",
    batch: "200",
    notes: "One batch coats 200 quail eggs. Oil is charged per piece fried.",
    lines: [
      { sku: "RAW-QUAIL-EGG", qty: "200", basis: "PER_BATCH", type: "RAW", wastage: "0.03" },
      { sku: "RAW-FLOUR", qty: "500", basis: "PER_BATCH", type: "RAW" },
      { sku: "RAW-CORNSTARCH", qty: "200", basis: "PER_BATCH", type: "RAW" },
      { sku: "RAW-SEASONING", qty: "50", basis: "PER_BATCH", type: "RAW" },
      { sku: "RAW-FOOD-COLOR", qty: "15", basis: "PER_BATCH", type: "RAW" },
      { sku: "OIL-COOKING", qty: "3.2", basis: "PER_PIECE", type: "OIL" },
      { sku: "PKG-STICK", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "PKG-CUP-SAUCE", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "CON-SAUCE-SWEET", qty: "30", basis: "PER_STICK", type: "CONDIMENT" },
    ],
  },
  {
    product: "FISHBALL",
    batch: "500",
    notes: "Bought ready-made and fried; the batch is simply what one fryer load holds.",
    lines: [
      { sku: "RAW-FISHBALL", qty: "500", basis: "PER_BATCH", type: "RAW", wastage: "0.02" },
      { sku: "OIL-COOKING", qty: "0.8", basis: "PER_PIECE", type: "OIL" },
      { sku: "PKG-STICK", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "PKG-CUP-SAUCE", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "CON-SAUCE-SPICY", qty: "30", basis: "PER_STICK", type: "CONDIMENT" },
    ],
  },
  {
    product: "SQUIDBALL",
    batch: "400",
    notes: "Ready-made, fried to order.",
    lines: [
      { sku: "RAW-SQUIDBALL", qty: "400", basis: "PER_BATCH", type: "RAW", wastage: "0.02" },
      { sku: "OIL-COOKING", qty: "1", basis: "PER_PIECE", type: "OIL" },
      { sku: "PKG-STICK", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "PKG-CUP-SAUCE", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "CON-SAUCE-SWEET", qty: "30", basis: "PER_STICK", type: "CONDIMENT" },
    ],
  },
  {
    product: "CALAMARES",
    batch: "300",
    notes: "Squid rings breaded in the commissary, 300 rings per batch.",
    lines: [
      { sku: "RAW-SQUID-RING", qty: "300", basis: "PER_BATCH", type: "RAW", wastage: "0.05" },
      { sku: "RAW-BREADCRUMB", qty: "300", basis: "PER_BATCH", type: "RAW" },
      { sku: "RAW-FLOUR", qty: "100", basis: "PER_BATCH", type: "RAW" },
      { sku: "RAW-SEASONING", qty: "20", basis: "PER_BATCH", type: "RAW" },
      { sku: "OIL-COOKING", qty: "2", basis: "PER_PIECE", type: "OIL" },
      { sku: "PKG-STICK", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "PKG-CUP-SAUCE", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "CON-VINEGAR", qty: "30", basis: "PER_STICK", type: "CONDIMENT" },
    ],
  },
  {
    product: "KIKIAM-BIG",
    batch: "300",
    notes: "Ready-made, sliced and fried.",
    lines: [
      { sku: "RAW-KIKIAM", qty: "300", basis: "PER_BATCH", type: "RAW", wastage: "0.02" },
      { sku: "OIL-COOKING", qty: "1.5", basis: "PER_PIECE", type: "OIL" },
      { sku: "PKG-STICK", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "PKG-CUP-SAUCE", qty: "1", basis: "PER_STICK", type: "PACKAGING" },
      { sku: "CON-SAUCE-SWEET", qty: "30", basis: "PER_STICK", type: "CONDIMENT" },
    ],
  },
];

export async function seedRecipes(db: Db, companyId: string): Promise<number> {
  const co = { companyId };
  let count = 0;

  for (const spec of RECIPES) {
    const product = await db.product.findUnique({
      where: { companyId_sku: { companyId, sku: spec.product } },
    });
    if (!product) continue;

    const recipe = await db.recipe.upsert({
      where: { productId_version: { productId: product.id, version: 1 } },
      update: { batchYieldPieces: spec.batch, notes: spec.notes, isActive: true },
      create: {
        ...co,
        productId: product.id,
        version: 1,
        batchYieldPieces: spec.batch,
        notes: spec.notes,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      },
    });

    for (const line of spec.lines) {
      const ingredient = await db.ingredient.findUnique({
        where: { companyId_sku: { companyId, sku: line.sku } },
      });
      if (!ingredient) continue;

      await db.recipeLine.upsert({
        where: {
          recipeId_ingredientId_allocationBasis: {
            recipeId: recipe.id,
            ingredientId: ingredient.id,
            allocationBasis: line.basis,
          },
        },
        update: { qtyInBaseUnit: line.qty, wastagePct: line.wastage ?? "0", componentType: line.type },
        create: {
          ...co,
          recipeId: recipe.id,
          ingredientId: ingredient.id,
          qtyInBaseUnit: line.qty,
          wastagePct: line.wastage ?? "0",
          allocationBasis: line.basis,
          componentType: line.type,
        },
      });
    }
    count += 1;
  }

  return count;
}
