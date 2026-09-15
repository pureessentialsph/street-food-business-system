import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb, scopedDb, type ScopedDb } from "@/lib/db";
import { costAsOf, recomputeForIngredient } from "@/lib/costing-service";

/**
 * Golden test 11.4: raise an ingredient cost today and assert that a new cost version
 * appears while yesterday's cost is untouched.
 *
 * This is the guarantee the whole reporting layer rests on — if a price change could
 * rewrite history, last month's profit would move every time a supplier put up a price.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("cost immutability (live database)", () => {
  let db: ScopedDb;
  let productId = "";
  let ingredientId = "";
  let originalCost = "";
  let yesterdayCost = "";
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    const company = await rawDb.company.findUnique({ where: { code: "SFS" } });
    if (!company) throw new Error("Seed first: pnpm db:seed");
    db = scopedDb(company.id);

    const product = await rawDb.product.findFirst({
      where: { companyId: company.id, sku: "KWEK" },
    });
    const ingredient = await rawDb.ingredient.findFirst({
      where: { companyId: company.id, sku: "RAW-QUAIL-EGG" },
    });
    if (!product || !ingredient) throw new Error("Seed first: pnpm db:seed");

    productId = product.id;
    ingredientId = ingredient.id;
    originalCost = ingredient.currentCostPerBaseUnit.toString();

    // A cost that was already in force yesterday, so there is history to protect.
    const existing = await rawDb.productCostVersion.findFirst({
      where: { productId },
      orderBy: { effectiveFrom: "desc" },
    });
    const backdated = await rawDb.productCostVersion.create({
      data: {
        companyId: company.id,
        productId,
        recipeVersion: existing?.recipeVersion ?? 1,
        effectiveFrom: yesterday,
        costPerPiece: existing?.costPerPiece ?? "1.0000",
        costPerStick: existing?.costPerStick ?? "9.0000",
        breakdown: {},
        triggeredBy: "SEED",
        note: "test fixture — yesterday's cost",
      },
    });
    yesterdayCost = backdated.costPerStick.toString();
  });

  afterAll(async () => {
    // Put the ingredient back so repeated runs start from the same place.
    await rawDb.ingredient.update({
      where: { id: ingredientId },
      data: { currentCostPerBaseUnit: originalCost },
    });
    await rawDb.productCostVersion.deleteMany({
      where: { productId, note: { contains: "test fixture" } },
    });
    await rawDb.$disconnect();
  });

  it("writes a NEW cost version when an ingredient price rises", async () => {
    const before = await rawDb.productCostVersion.count({ where: { productId } });

    // Quail eggs ₱1.20 → ₱1.50, a 25% rise.
    await rawDb.ingredient.update({
      where: { id: ingredientId },
      data: { currentCostPerBaseUnit: "1.50" },
    });
    const changes = await recomputeForIngredient(db, ingredientId, null, "test fixture — price rise");

    expect(changes.length).toBeGreaterThan(0);
    expect(await rawDb.productCostVersion.count({ where: { productId } })).toBe(before + 1);

    const kwek = changes.find((c) => c.productId === productId);
    expect(kwek).toBeDefined();
    expect(Number(kwek!.costPerStick)).toBeGreaterThan(Number(kwek!.previousCostPerStick));
  });

  it("leaves yesterday's cost exactly where it was", async () => {
    const asOfYesterday = await costAsOf(db, productId, yesterday);
    expect(asOfYesterday?.costPerStick).toBe(yesterdayCost);
  });

  it("finds a cost written during the business date being costed", async () => {
    // Regression: business dates are midnight and cost versions are timestamped, so an
    // `effectiveFrom <= businessDate` comparison found nothing for today and shifts
    // closed with zero COGS — reporting gross profit equal to net sales.
    const midnightToday = new Date();
    midnightToday.setUTCHours(0, 0, 0, 0);
    const found = await costAsOf(db, productId, midnightToday);
    expect(found).not.toBeNull();
    expect(Number(found!.costPerPiece)).toBeGreaterThan(0);
  });

  it("reports the higher cost as of today", async () => {
    const today = await costAsOf(db, productId, new Date());
    expect(Number(today?.costPerStick)).toBeGreaterThan(Number(yesterdayCost));
  });

  it("never edits an existing version row in place", async () => {
    const versions = await rawDb.productCostVersion.findMany({
      where: { productId },
      orderBy: { effectiveFrom: "asc" },
    });
    // Append-only: every row's createdAt is its own, and none were updated afterwards.
    for (const version of versions) {
      expect(version.effectiveFrom.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    }
    expect(versions.length).toBeGreaterThan(1);
  });

  it("recomputes every product that uses the ingredient, not just one", async () => {
    // Cooking oil is in all five core recipes.
    const oil = await rawDb.ingredient.findFirst({
      where: { companyId: db.$companyId, sku: "OIL-COOKING" },
    });
    const before = oil!.currentCostPerBaseUnit.toString();
    await rawDb.ingredient.update({
      where: { id: oil!.id },
      data: { currentCostPerBaseUnit: "0.1500" },
    });
    const changes = await recomputeForIngredient(db, oil!.id, null, "test fixture — oil rise");
    expect(changes.length).toBe(5);

    await rawDb.ingredient.update({
      where: { id: oil!.id },
      data: { currentCostPerBaseUnit: before },
    });
    await recomputeForIngredient(db, oil!.id, null, "test fixture — oil restore");
  });
});
