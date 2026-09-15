import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb, scopedDb, type ScopedDb } from "@/lib/db";
import { businessDateFor, toDateColumn } from "@/lib/businessDate";
import { dec } from "@/lib/money";
import { onHand, postLedger, rebuildBalances } from "@/lib/inventory-service";
import { reconcileShift } from "@/lib/engines/reconciliation";

/**
 * Golden test 11.2 and 11.3 together, against a live database: the full day for one
 * cart, and the ledger it leaves behind.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("the core loop (live database)", () => {
  let db: ScopedDb;
  let shiftId = "";
  let productId = "";
  let employeeId = "";
  let branchId = "";
  const businessDate = toDateColumn(businessDateFor());
  const cleanupRefs: string[] = [];

  beforeAll(async () => {
    const company = await rawDb.company.findUnique({ where: { code: "SFS" } });
    if (!company) throw new Error("Seed first");
    db = scopedDb(company.id);

    const product = await rawDb.product.findFirst({ where: { companyId: company.id, sku: "FISHBALL" } });
    const cart = await rawDb.cart.findFirst({ where: { companyId: company.id, code: "CART-003" } });
    const employee = await rawDb.employee.findFirst({ where: { companyId: company.id, employeeNo: "EMP-003" } });
    productId = product!.id;
    employeeId = employee!.id;
    branchId = cart!.branchId;

    await rawDb.cartShift.deleteMany({ where: { cartId: cart!.id, businessDate } });
    const shift = await rawDb.cartShift.create({
      data: {
        companyId: company.id, cartId: cart!.id, employeeId, branchId,
        businessDate, status: "OPEN",
      },
    });
    shiftId = shift.id;
    cleanupRefs.push(shiftId);
  });

  afterAll(async () => {
    await rawDb.inventoryTransaction.deleteMany({ where: { refId: { in: cleanupRefs } } });
    await rawDb.cartShift.deleteMany({ where: { id: shiftId } });
    // Deleting ledger rows leaves the cache stale — production never does this, but a
    // test that skips the rebuild poisons the next run's integrity check.
    await rebuildBalances(db);
    await rawDb.$disconnect();
  });

  it("issues a load-out and a refill into one running total", async () => {
    for (const [seq, qty] of [[1, "400"], [2, "200"]] as const) {
      const issue = await rawDb.shiftIssue.create({
        data: { companyId: db.$companyId, shiftId, seq, isRefill: seq > 1 },
      });
      cleanupRefs.push(issue.id);
      await rawDb.shiftIssueLine.create({
        data: {
          companyId: db.$companyId, issueId: issue.id, productId,
          qtyPieces: qty, unitCostPerPiece: "0.45", pricePerStick: "10.00", piecesPerStick: "10",
        },
      });
      await postLedger(db, [
        { itemType: "PRODUCT", itemId: productId, locationType: "BRANCH", locationId: branchId,
          qty: `-${qty}`, unitCost: "0.45", type: "ISSUE_TO_VENDOR", refType: "ShiftIssue",
          refId: issue.id, businessDate },
        { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
          qty, unitCost: "0.45", type: "ISSUE_TO_VENDOR", refType: "ShiftIssue",
          refId: issue.id, businessDate },
      ], null);
    }

    const held = await onHand(db, "PRODUCT", productId, "EMPLOYEE", employeeId);
    expect(dec(held.qty).toFixed(0)).toBe("600");
  });

  it("derives the spec's figures from the closing count", async () => {
    const result = reconcileShift({ cashRemitted: "528.00" }, [{
      productId, productName: "Fishball",
      piecesIssued: 600, piecesReturned: 50, piecesWasted: 10,
      piecesPerStick: 10, pricePerStick: "10.00", unitCostPerPiece: "0.45",
    }]);

    expect(result.piecesSold.toFixed(0)).toBe("540");
    expect(result.netSales.toFixed(2)).toBe("540.00");
    expect(result.cashVariance.toFixed(2)).toBe("-12.00");
    expect(result.cogs.toFixed(2)).toBe("243.00");
    expect(result.grossProfit.toFixed(2)).toBe("297.00");
    expect(result.isDisputed).toBe(false);

    await postLedger(db, [
      { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
        qty: "-540", unitCost: "0.45", type: "SALE_CONSUMPTION", refType: "CartShift", refId: shiftId, businessDate },
      { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
        qty: "-50", unitCost: "0.45", type: "RETURN_FROM_VENDOR", refType: "CartShift", refId: shiftId, businessDate },
      { itemType: "PRODUCT", itemId: productId, locationType: "BRANCH", locationId: branchId,
        qty: "50", unitCost: "0.45", type: "RETURN_FROM_VENDOR", refType: "CartShift", refId: shiftId, businessDate },
      { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
        qty: "-10", unitCost: "0.45", type: "WASTE", refType: "CartShift", refId: shiftId, businessDate },
    ], null);
  });

  it("leaves the vendor holding nothing once the day is reconciled", async () => {
    const held = await onHand(db, "PRODUCT", productId, "EMPLOYEE", employeeId);
    expect(dec(held.qty).toFixed(0)).toBe("0");
  });

  it("enforces one shift per cart per business date", async () => {
    const shift = await rawDb.cartShift.findUnique({ where: { id: shiftId } });
    await expect(
      rawDb.cartShift.create({
        data: {
          companyId: db.$companyId, cartId: shift!.cartId, employeeId,
          branchId, businessDate, status: "OPEN",
        },
      }),
    ).rejects.toThrow();
  });
});
