import type { InventoryTxnType, StockLocationType } from "@prisma/client";

/** One place for the words operators read, so the ledger explains itself. */
export const TXN_LABEL: Record<InventoryTxnType, string> = {
  PURCHASE_RECEIPT: "Received from supplier",
  PRODUCTION_IN: "Produced",
  PRODUCTION_CONSUME: "Used in production",
  TRANSFER_OUT: "Transferred out",
  TRANSFER_IN: "Transferred in",
  ISSUE_TO_VENDOR: "Issued to vendor / Labas",
  RETURN_FROM_VENDOR: "Returned by vendor / Balik",
  SALE_CONSUMPTION: "Sold",
  WASTE: "Wasted / Sira",
  SPOILAGE: "Spoiled",
  DAMAGE: "Damaged",
  ADJUSTMENT: "Adjustment",
  COUNT_VARIANCE: "Count variance",
};

export const LOCATION_LABEL: Record<StockLocationType, string> = {
  WAREHOUSE: "Warehouse",
  BRANCH: "Branch",
  CART: "Cart",
  EMPLOYEE: "Vendor",
};

/** Resolve location ids to names in one pass, whatever kind of location they are. */
export async function locationNames(
  db: {
    branch: { findMany: (a: never) => Promise<{ id: string; code: string; name: string }[]> };
    cart: { findMany: (a: never) => Promise<{ id: string; code: string; name: string }[]> };
    employee: { findMany: (a: never) => Promise<{ id: string; firstName: string; lastName: string }[]> };
  },
): Promise<Map<string, string>> {
  const [branches, carts, employees] = await Promise.all([
    db.branch.findMany({ select: { id: true, code: true, name: true } } as never),
    db.cart.findMany({ select: { id: true, code: true, name: true } } as never),
    db.employee.findMany({ select: { id: true, firstName: true, lastName: true } } as never),
  ]);

  const map = new Map<string, string>();
  for (const branch of branches) map.set(branch.id, `${branch.code} · ${branch.name}`);
  for (const cart of carts) map.set(cart.id, `${cart.code} · ${cart.name}`);
  for (const employee of employees) map.set(employee.id, `${employee.firstName} ${employee.lastName}`);
  return map;
}
