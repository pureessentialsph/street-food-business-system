"use server";

import { z } from "zod";
import { decimalString } from "@/lib/validation/masterdata";
import { describeChanges, recomputeAll, recomputeProduct } from "@/lib/costing-service";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

const recipeSchema = z.object({
  productId: z.string().min(1),
  batchYieldPieces: decimalString("Batch yield", { min: 0, allowZero: false }),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

const recipeLineSchema = z.object({
  ingredientId: z.string().min(1, "Choose an ingredient"),
  qtyInBaseUnit: decimalString("Quantity", { min: 0, allowZero: false }),
  wastagePct: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, "Wastage is a percentage, e.g. 5 for 5%")
    .refine((v) => Number(v) <= 100, "Wastage cannot exceed 100%"),
  allocationBasis: z.enum(["PER_BATCH", "PER_PIECE", "PER_STICK"]),
  componentType: z.enum(["RAW", "PACKAGING", "CONDIMENT", "OIL", "CONSUMABLE"]),
});

/** Create or update the active recipe for a product, then re-snapshot its cost. */
export async function saveRecipe(
  recipeId: string | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("costing.write");
    const parsed = parseForm(recipeSchema, formData);
    if (!parsed.ok) return parsed.result;
    const { productId, batchYieldPieces, notes } = parsed.data;

    let id = recipeId;
    if (id) {
      const before = await ctx.db.recipe.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That recipe no longer exists." };
      const after = await ctx.db.recipe.update({
        where: { id },
        data: { batchYieldPieces, notes: notes ?? null },
      });
      await audit(ctx, "UPDATE", "Recipe", id, before, after);
    } else {
      const latest = await ctx.db.recipe.findFirst({
        where: { productId },
        orderBy: { version: "desc" },
      });
      const created = await ctx.db.recipe.create({
        data: {
          companyId: ctx.db.$companyId,
          productId,
          version: (latest?.version ?? 0) + 1,
          batchYieldPieces,
          notes: notes ?? null,
          effectiveFrom: new Date(),
          isActive: true,
        },
      });
      // Only one active recipe per product; older versions stay for history.
      await ctx.db.recipe.updateMany({
        where: { productId, id: { not: created.id } },
        data: { isActive: false },
      });
      await audit(ctx, "CREATE", "Recipe", created.id, null, created);
      id = created.id;
    }

    const change = await recomputeProduct(
      ctx.db, productId, recipeId ? "RECIPE_EDITED" : "RECIPE_CREATED", ctx.user.id,
    );
    refresh("/costing", `/costing/${productId}`, "/products");
    return {
      ok: true,
      id,
      message: change ? `Saved. Cost is now ₱${change.costPerStick} a stick.` : "Saved.",
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveRecipeLine(
  recipeId: string,
  lineId: string | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("costing.write");
    const parsed = parseForm(recipeLineSchema, formData);
    if (!parsed.ok) return parsed.result;

    const recipe = await ctx.db.recipe.findUnique({ where: { id: recipeId } });
    if (!recipe) return { ok: false, error: "That recipe no longer exists." };

    // Percent in the form, fraction in the database — the engine multiplies by (1 + w).
    const data = {
      ingredientId: parsed.data.ingredientId,
      qtyInBaseUnit: parsed.data.qtyInBaseUnit,
      wastagePct: (Number(parsed.data.wastagePct) / 100).toFixed(4),
      allocationBasis: parsed.data.allocationBasis,
      componentType: parsed.data.componentType,
    };

    if (lineId) {
      const before = await ctx.db.recipeLine.findUnique({ where: { id: lineId } });
      if (!before) return { ok: false, error: "That line no longer exists." };
      const after = await ctx.db.recipeLine.update({ where: { id: lineId }, data });
      await audit(ctx, "UPDATE", "RecipeLine", lineId, before, after);
    } else {
      const existing = await ctx.db.recipeLine.findFirst({
        where: {
          recipeId,
          ingredientId: data.ingredientId,
          allocationBasis: data.allocationBasis,
        },
      });
      if (existing) {
        const after = await ctx.db.recipeLine.update({ where: { id: existing.id }, data });
        await audit(ctx, "UPDATE", "RecipeLine", existing.id, existing, after);
      } else {
        const created = await ctx.db.recipeLine.create({
          data: { ...data, recipeId, companyId: ctx.db.$companyId },
        });
        await audit(ctx, "CREATE", "RecipeLine", created.id, null, created);
      }
    }

    const change = await recomputeProduct(ctx.db, recipe.productId, "RECIPE_EDITED", ctx.user.id);
    refresh("/costing", `/costing/${recipe.productId}`, "/products");
    return {
      ok: true,
      message: change ? `Line saved. Cost is now ₱${change.costPerStick} a stick.` : "Line saved.",
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function removeRecipeLine(lineId: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("costing.write");
    const before = await ctx.db.recipeLine.findUnique({
      where: { id: lineId },
      include: { recipe: { select: { productId: true } } },
    });
    if (!before) return { ok: false, error: "That line is already gone." };

    await ctx.db.recipeLine.delete({ where: { id: lineId } });
    await audit(ctx, "DELETE", "RecipeLine", lineId, before, null);

    const change = await recomputeProduct(ctx.db, before.recipe.productId, "RECIPE_EDITED", ctx.user.id);
    refresh("/costing", `/costing/${before.recipe.productId}`, "/products");
    return {
      ok: true,
      message: change ? `Removed. Cost is now ₱${change.costPerStick} a stick.` : "Removed.",
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** "Recalculate all" — useful after a bulk ingredient price import. */
export async function recalculateAllCosts(): Promise<ActionResult> {
  try {
    const ctx = await withPermission("costing.write");
    const changes = await recomputeAll(ctx.db, "MANUAL_RECALC", ctx.user.id);
    refresh("/costing", "/products");
    return { ok: true, message: describeChanges(changes) };
  } catch (error) {
    return toActionError(error);
  }
}
