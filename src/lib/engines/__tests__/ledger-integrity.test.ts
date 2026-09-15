import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawDb, scopedDb, type ScopedDb } from "@/lib/db";
import { businessDateFor, toDateColumn } from "@/lib/businessDate";
import { dec } from "@/lib/money";
import { onHand, postLedger, rebuildBalances } from "@/lib/inventory-service";

/**
 * Golden test 11.3: after stock has moved supplier → commissary → cart → vendor and
 * back, the vendor's ledger sums to zero and every cached balance agrees with the
 * ledger it was built from.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("ledger integrity (live database)", () => {
  let db: ScopedDb;
  let productId = "";
  let branchId = "";
  let cartId = "";
  let employeeId = "";
  const refId = `test-ledger-${Date.now()}`;
  const businessDate = toDateColumn(businessDateFor());

  beforeAll(async () => {
    const company = await rawDb.company.findUnique({ where: { code: "SFS" } });
    if (!company) throw new Error("Seed first: pnpm db:seed");
    db = scopedDb(company.id);

    const product = await rawDb.product.findFirst({ where: { companyId: company.id, sku: "FISHBALL" } });
    const branch = await rawDb.branch.findFirst({ where: { companyId: company.id, code: "BR-01" } });
    const cart = await rawDb.cart.findFirst({ where: { companyId: company.id, code: "CART-001" } });
    const employee = await rawDb.employee.findFirst({ where: { companyId: company.id, employeeNo: "EMP-001" } });
    productId = product!.id;
    branchId = branch!.id;
    cartId = cart!.id;
    employeeId = employee!.id;
  });

  afterAll(async () => {
    await rawDb.inventoryTransaction.deleteMany({ where: { refId } });
    await rebuildBalances(db);
    await rawDb.$disconnect();
  });

  it("nets to zero at the vendor after a full day: issued, sold, returned, wasted", async () => {
    // 400 issued, refilled +200, 540 sold, 50 returned, 10 wasted (spec 11.2 figures).
    await postLedger(db, [
      { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
        qty: "400", unitCost: "0.45", type: "ISSUE_TO_VENDOR", refType: "Test", refId, businessDate },
      { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
        qty: "200", unitCost: "0.45", type: "ISSUE_TO_VENDOR", refType: "Test", refId, businessDate },
      { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
        qty: "-540", unitCost: "0.45", type: "SALE_CONSUMPTION", refType: "Test", refId, businessDate },
      { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
        qty: "-50", unitCost: "0.45", type: "RETURN_FROM_VENDOR", refType: "Test", refId, businessDate },
      { itemType: "PRODUCT", itemId: productId, locationType: "EMPLOYEE", locationId: employeeId,
        qty: "-10", unitCost: "0.45", type: "WASTE", refType: "Test", refId, businessDate },
    ], null);

    const rows = await rawDb.inventoryTransaction.findMany({
      where: { refId, locationType: "EMPLOYEE", locationId: employeeId },
    });
    const sum = rows.reduce((acc, row) => acc.plus(row.qty.toString()), dec(0));
    expect(sum.toFixed(0)).toBe("0");

    const balance = await onHand(db, "PRODUCT", productId, "EMPLOYEE", employeeId);
    expect(dec(balance.qty).toFixed(0)).toBe("0");
  });

  it("pairs a transfer so the branch loses exactly what the cart gains", async () => {
    await postLedger(db, [
      { itemType: "PRODUCT", itemId: productId, locationType: "BRANCH", locationId: branchId,
        qty: "-300", unitCost: "0.45", type: "TRANSFER_OUT", refType: "Test", refId, businessDate },
      { itemType: "PRODUCT", itemId: productId, locationType: "CART", locationId: cartId,
        qty: "300", unitCost: "0.45", type: "TRANSFER_IN", refType: "Test", refId, businessDate },
    ], null);

    const rows = await rawDb.inventoryTransaction.findMany({
      where: { refId, type: { in: ["TRANSFER_OUT", "TRANSFER_IN"] } },
    });
    const net = rows.reduce((acc, row) => acc.plus(row.qty.toString()), dec(0));
    expect(net.toFixed(0)).toBe("0");
  });

  it("keeps every cached balance equal to the ledger sum behind it", async () => {
    const grouped = await rawDb.inventoryTransaction.groupBy({
      by: ["itemType", "itemId", "locationType", "locationId", "companyId"],
      _sum: { qty: true },
    });

    for (const group of grouped) {
      const cached = await rawDb.stockBalance.findFirst({
        where: {
          companyId: group.companyId,
          itemType: group.itemType,
          itemId: group.itemId,
          locationType: group.locationType,
          locationId: group.locationId,
        },
      });
      const ledgerSum = dec(group._sum.qty?.toString() ?? "0");
      expect(cached, `no cached balance for ${group.itemId} at ${group.locationType}`).not.toBeNull();
      expect(dec(cached!.qty).toFixed(4)).toBe(ledgerSum.toFixed(4));
    }
  });

  it("zeroes a cached balance whose ledger rows have all gone", async () => {
    // Regression: rebuild once only visited items the ledger still knew about, so a
    // balance could outlive its movements and overstate stock indefinitely.
    const orphanRef = `${refId}-orphan`;
    // Its own cart, so the other tests in this file cannot muddy the numbers.
    const spare = await rawDb.cart.findFirst({
      where: { companyId: db.$companyId, code: "CART-008" },
    });
    const spareCartId = spare!.id;

    const before = dec((await onHand(db, "PRODUCT", productId, "CART", spareCartId)).qty);

    await postLedger(db, [{
      itemType: "PRODUCT", itemId: productId, locationType: "CART", locationId: spareCartId,
      qty: "250", unitCost: "0.45", type: "TRANSFER_IN",
      refType: "Test", refId: orphanRef, businessDate,
    }], null);

    const stocked = dec((await onHand(db, "PRODUCT", productId, "CART", spareCartId)).qty);
    expect(stocked.minus(before).toFixed(0)).toBe("250");

    await rawDb.inventoryTransaction.deleteMany({ where: { refId: orphanRef } });
    const { drift } = await rebuildBalances(db);

    expect(drift).toBeGreaterThan(0);
    // With no ledger rows left for this pair, the cache must read zero — not 250.
    expect(dec((await onHand(db, "PRODUCT", productId, "CART", spareCartId)).qty).toFixed(0)).toBe("0");
  });

  it("rebuilds the cache from the ledger without changing a single figure", async () => {
    const before = await rawDb.stockBalance.findMany({ orderBy: { id: "asc" } });
    const { drift } = await rebuildBalances(db);
    const after = await rawDb.stockBalance.findMany({ orderBy: { id: "asc" } });

    expect(drift).toBe(0);
    expect(after).toHaveLength(before.length);
    for (const [index, row] of after.entries()) {
      expect(row.qty.toString()).toBe(before[index]!.qty.toString());
    }
  });
});
