/**
 * Phase 1 master data for a realistic Philippine street-food operation.
 *
 * Idempotent like the rest of the seed: every row is upserted on its business key, so
 * running it twice changes nothing. Called from prisma/seed.ts.
 *
 * The numbers here are illustrative and marked TODO_OWNER where the owner still has to
 * supply the real figures (spec §15, master data section).
 */
import type { PrismaClient } from "@prisma/client";

type Db = PrismaClient;

const PIECES_PER_STICK = {
  KWEK: 4,
  CALAMARES: 3,
  SQUIDBALL: 5,
  FISHBALL: 10,
  KIKIAM: 4,
} as const;

export async function seedMasterData(db: Db, companyId: string) {
  const co = { companyId };

  // ---------------------------------------------------------------- locations
  const locations = [
    { name: "University Belt — Morayta", type: "SCHOOL" as const },
    { name: "Recto LRT Station", type: "TERMINAL" as const },
    { name: "Divisoria Market", type: "MARKET" as const },
    { name: "Ortigas Office Strip", type: "OFFICE" as const },
    { name: "Cainta Industrial Park", type: "FACTORY" as const },
    { name: "Antipolo Public Market", type: "MARKET" as const },
    { name: "Marikina Riverbanks", type: "COMMERCIAL" as const },
    { name: "Concepcion Residences", type: "RESIDENTIAL" as const },
  ];
  const locationIds = new Map<string, string>();
  for (const loc of locations) {
    const row = await db.location.upsert({
      where: { companyId_name: { companyId, name: loc.name } },
      update: { type: loc.type },
      create: { ...co, ...loc },
    });
    locationIds.set(loc.name, row.id);
  }

  // ---------------------------------------------------------------- positions
  // Seeded suggestions only. A title typed into the employee form joins this list.
  const positions = [
    { name: "Vendor", sortOrder: 1 },
    { name: "Branch Supervisor", sortOrder: 2 },
    { name: "Area Manager", sortOrder: 3 },
    { name: "Commissary Staff", sortOrder: 4 },
    { name: "Commissary Lead", sortOrder: 5 },
    { name: "Motor Cart Driver", sortOrder: 6 },
    { name: "Kitchen Helper", sortOrder: 7 },
    { name: "Admin Staff", sortOrder: 8 },
  ];
  for (const position of positions) {
    await db.position.upsert({
      where: { companyId_name: { companyId, name: position.name } },
      update: { sortOrder: position.sortOrder },
      create: { ...co, ...position },
    });
  }

  // ------------------------------------------------------ compensation schemes
  // An earlier seed used a longer name for the same scheme; rename in place so the
  // employees already pointing at it keep their link.
  const legacy = await db.compensationScheme.findFirst({
    where: { companyId, name: "Vendor — daily rate plus set incentive" },
  });
  if (legacy) {
    await db.compensationScheme.update({
      where: { id: legacy.id },
      data: { name: "Daily Rate + Set Incentive" },
    });
  }

  const schemes = [
    {
      name: "Daily Rate",
      description:
        "Flat daily pay for a closed shift. No set incentive — used for supervisors, commissary and drivers.",
    },
    {
      name: "Daily Rate + Set Incentive",
      description:
        "₱500 base per closed shift, plus per-component credit from the standard set. Cash shortages deducted in full once the vendor acknowledges the count.",
    },
  ];

  const schemeIds = new Map<string, string>();
  for (const s of schemes) {
    const row = await db.compensationScheme.upsert({
      where: { companyId_name: { companyId, name: s.name } },
      update: { description: s.description },
      create: {
        ...co,
        name: s.name,
        baseDailyRate: "500", // TODO_OWNER: confirm the real daily rate
        deductShortage: s.name !== "Daily Rate",
        maxShortageDeduction: null, // uncapped, per the owner's decision
        description: s.description,
      },
    });
    schemeIds.set(s.name, row.id);
  }
  const scheme = { id: schemeIds.get("Daily Rate + Set Incentive")! };
  const flatScheme = { id: schemeIds.get("Daily Rate")! };

  // Rules are data (spec §5.6). The vendor scheme pays per-component set credits; the
  // flat scheme pays base only, so it carries no incentive rules at all.
  const existingRule = await db.compensationRule.findFirst({
    where: { companyId, schemeId: scheme.id, type: "SET_COMPLETION" },
  });
  if (!existingRule) {
    await db.compensationRule.create({
      data: {
        ...co,
        schemeId: scheme.id,
        type: "SET_COMPLETION",
        priority: 10,
        params: { requireZeroShortage: false },
      },
    });
  }

  // ---------------------------------------------------------------- suppliers
  const suppliers = [
    { name: "Divisoria Poultry Supply", contactPerson: "Aling Nena", mobile: "0917 555 0101", leadTimeDays: 1, paymentTerms: "COD" },
    { name: "Manila Frozen Goods Trading", contactPerson: "Mr. Tan", mobile: "0918 555 0202", leadTimeDays: 2, paymentTerms: "7 days" },
    { name: "Bulacan Flour & Dry Goods", contactPerson: "Ramon Cruz", mobile: "0919 555 0303", leadTimeDays: 3, paymentTerms: "15 days" },
    { name: "Pasig Packaging Supply", contactPerson: "Liza Reyes", mobile: "0920 555 0404", leadTimeDays: 2, paymentTerms: "COD" },
    { name: "Caltex LPG Dealer", contactPerson: "Boy Santos", mobile: "0921 555 0505", leadTimeDays: 1, paymentTerms: "COD" },
  ];
  const supplierIds = new Map<string, string>();
  for (const s of suppliers) {
    const row = await db.supplier.upsert({
      where: { companyId_name: { companyId, name: s.name } },
      update: { leadTimeDays: s.leadTimeDays },
      create: { ...co, ...s },
    });
    supplierIds.set(s.name, row.id);
  }

  // -------------------------------------------------------------- ingredients
  // Costs are per BASE unit: per gram, per millilitre, or per piece.
  const ingredients = [
    { sku: "RAW-QUAIL-EGG", name: "Quail egg", category: "RAW", baseUnit: "PC", cost: "1.2000", pack: "300", safety: "600" },
    { sku: "RAW-FISHBALL", name: "Fishball (frozen)", category: "RAW", baseUnit: "PC", cost: "0.4500", pack: "250", safety: "1000" },
    { sku: "RAW-SQUIDBALL", name: "Squidball (frozen)", category: "RAW", baseUnit: "PC", cost: "0.8000", pack: "200", safety: "500" },
    { sku: "RAW-KIKIAM", name: "Kikiam big (frozen)", category: "RAW", baseUnit: "PC", cost: "1.1000", pack: "150", safety: "400" },
    { sku: "RAW-SQUID-RING", name: "Squid ring (frozen)", category: "RAW", baseUnit: "PC", cost: "2.1000", pack: "100", safety: "300" },
    { sku: "RAW-CHICKEN-SKIN", name: "Chicken skin", category: "RAW", baseUnit: "G", cost: "0.2400", pack: "1000", safety: "2000" },
    { sku: "RAW-POTATO", name: "Potato (for fries)", category: "RAW", baseUnit: "G", cost: "0.0900", pack: "1000", safety: "3000" },
    { sku: "RAW-FLOUR", name: "All-purpose flour", category: "RAW", baseUnit: "G", cost: "0.0600", pack: "25000", safety: "10000" },
    { sku: "RAW-CORNSTARCH", name: "Cornstarch", category: "RAW", baseUnit: "G", cost: "0.0800", pack: "1000", safety: "3000" },
    { sku: "RAW-BREADCRUMB", name: "Breadcrumbs", category: "RAW", baseUnit: "G", cost: "0.1100", pack: "1000", safety: "2000" },
    { sku: "RAW-SEASONING", name: "Seasoning mix", category: "RAW", baseUnit: "G", cost: "0.2000", pack: "500", safety: "1000" },
    { sku: "RAW-FOOD-COLOR", name: "Orange food colouring", category: "RAW", baseUnit: "ML", cost: "0.3500", pack: "250", safety: "500" },
    { sku: "RAW-SALT", name: "Iodised salt", category: "RAW", baseUnit: "G", cost: "0.0250", pack: "1000", safety: "2000" },
    { sku: "OIL-COOKING", name: "Cooking oil", category: "OIL", baseUnit: "ML", cost: "0.1100", pack: "18000", safety: "18000" },
    { sku: "CON-SAUCE-SWEET", name: "Sweet sauce", category: "CONDIMENT", baseUnit: "ML", cost: "0.0400", pack: "4000", safety: "8000" },
    { sku: "CON-SAUCE-SPICY", name: "Spicy vinegar sauce", category: "CONDIMENT", baseUnit: "ML", cost: "0.0350", pack: "4000", safety: "8000" },
    { sku: "CON-VINEGAR", name: "Vinegar", category: "CONDIMENT", baseUnit: "ML", cost: "0.0300", pack: "4000", safety: "4000" },
    { sku: "CON-KETCHUP", name: "Banana ketchup", category: "CONDIMENT", baseUnit: "ML", cost: "0.0500", pack: "2000", safety: "2000" },
    { sku: "PKG-STICK", name: "Bamboo stick", category: "PACKAGING", baseUnit: "PC", cost: "0.1500", pack: "1000", safety: "3000" },
    { sku: "PKG-CUP-SAUCE", name: "Sauce cup", category: "PACKAGING", baseUnit: "PC", cost: "0.3500", pack: "500", safety: "2000" },
    { sku: "PKG-PAPER-BAG", name: "Paper bag", category: "PACKAGING", baseUnit: "PC", cost: "0.5000", pack: "500", safety: "1500" },
    { sku: "PKG-PLASTIC-BAG", name: "Plastic bag", category: "PACKAGING", baseUnit: "PC", cost: "0.2000", pack: "1000", safety: "2000" },
    { sku: "PKG-CUP-DRINK", name: "Drink cup with lid", category: "PACKAGING", baseUnit: "PC", cost: "1.8000", pack: "250", safety: "500" },
    { sku: "CSM-LPG", name: "LPG gas", category: "CONSUMABLE", baseUnit: "G", cost: "0.0850", pack: "11000", safety: "11000" },
    { sku: "CSM-TISSUE", name: "Tissue / napkin", category: "CONSUMABLE", baseUnit: "PC", cost: "0.0800", pack: "1000", safety: "2000" },
  ] as const;

  const ingredientIds = new Map<string, string>();
  for (const ing of ingredients) {
    const row = await db.ingredient.upsert({
      where: { companyId_sku: { companyId, sku: ing.sku } },
      update: { name: ing.name },
      create: {
        ...co,
        sku: ing.sku,
        name: ing.name,
        category: ing.category,
        baseUnit: ing.baseUnit,
        currentCostPerBaseUnit: ing.cost,
        packSize: ing.pack,
        minStock: ing.safety,
        safetyStock: ing.safety,
      },
    });
    ingredientIds.set(ing.sku, row.id);

    const hasHistory = await db.ingredientCostHistory.findFirst({ where: { ingredientId: row.id } });
    if (!hasHistory) {
      await db.ingredientCostHistory.create({
        data: { ...co, ingredientId: row.id, costPerBaseUnit: ing.cost, effectiveFrom: new Date(), source: "MANUAL" },
      });
    }
  }

  // Link the main suppliers to what they actually sell, with their purchase units.
  const links = [
    { supplier: "Divisoria Poultry Supply", sku: "RAW-QUAIL-EGG", unit: "tray 300 pcs", per: "300", price: "360" },
    { supplier: "Manila Frozen Goods Trading", sku: "RAW-FISHBALL", unit: "pack 250 pcs", per: "250", price: "112.50" },
    { supplier: "Manila Frozen Goods Trading", sku: "RAW-SQUIDBALL", unit: "pack 200 pcs", per: "200", price: "160" },
    { supplier: "Manila Frozen Goods Trading", sku: "RAW-KIKIAM", unit: "pack 150 pcs", per: "150", price: "165" },
    { supplier: "Manila Frozen Goods Trading", sku: "RAW-SQUID-RING", unit: "pack 100 pcs", per: "100", price: "210" },
    { supplier: "Bulacan Flour & Dry Goods", sku: "RAW-FLOUR", unit: "sack 25 kg", per: "25000", price: "1500" },
    { supplier: "Bulacan Flour & Dry Goods", sku: "RAW-CORNSTARCH", unit: "pack 1 kg", per: "1000", price: "80" },
    { supplier: "Pasig Packaging Supply", sku: "PKG-STICK", unit: "bundle 1000 pcs", per: "1000", price: "150" },
    { supplier: "Pasig Packaging Supply", sku: "PKG-CUP-SAUCE", unit: "pack 500 pcs", per: "500", price: "175" },
    { supplier: "Caltex LPG Dealer", sku: "CSM-LPG", unit: "tank 11 kg", per: "11000", price: "935" },
  ];
  for (const link of links) {
    const supplierId = supplierIds.get(link.supplier);
    const ingredientId = ingredientIds.get(link.sku);
    if (!supplierId || !ingredientId) continue;
    await db.supplierIngredient.upsert({
      where: { supplierId_ingredientId: { supplierId, ingredientId } },
      update: { lastPurchasePrice: link.price },
      create: {
        ...co,
        supplierId,
        ingredientId,
        purchaseUnitName: link.unit,
        baseUnitsPerPurchaseUnit: link.per,
        lastPurchasePrice: link.price,
        isPreferred: true,
      },
    });
  }

  // ------------------------------------------------------ categories + products
  const categories = [
    { name: "Fried snacks", sortOrder: 1 },
    { name: "Fries & sides", sortOrder: 2 },
    { name: "Beverages", sortOrder: 3 },
  ];
  const categoryIds = new Map<string, string>();
  for (const cat of categories) {
    const row = await db.productCategory.upsert({
      where: { companyId_name: { companyId, name: cat.name } },
      update: { sortOrder: cat.sortOrder },
      create: { ...co, ...cat },
    });
    categoryIds.set(cat.name, row.id);
  }

  // piecesPerStick is the conversion the entire system depends on (spec §5.3.1).
  const products = [
    { sku: "KWEK", name: "Kwek-kwek", cat: "Fried snacks", pps: PIECES_PER_STICK.KWEK, price: "15.00" },
    { sku: "CALAMARES", name: "Calamares / squid rings", cat: "Fried snacks", pps: PIECES_PER_STICK.CALAMARES, price: "20.00" },
    { sku: "SQUIDBALL", name: "Squidball", cat: "Fried snacks", pps: PIECES_PER_STICK.SQUIDBALL, price: "15.00" },
    { sku: "FISHBALL", name: "Fishball", cat: "Fried snacks", pps: PIECES_PER_STICK.FISHBALL, price: "10.00" },
    { sku: "KIKIAM-BIG", name: "Kikiam (big)", cat: "Fried snacks", pps: PIECES_PER_STICK.KIKIAM, price: "15.00" },
    { sku: "CHICKEN-SKIN", name: "Chicken skin", cat: "Fried snacks", pps: 4, price: "20.00" },
    { sku: "KIKIAM-SMALL", name: "Kikiam (small)", cat: "Fried snacks", pps: 6, price: "10.00" },
    { sku: "FRIES-REG", name: "Fries (regular)", cat: "Fries & sides", pps: 1, price: "25.00" },
    { sku: "FRIES-LARGE", name: "Fries (large)", cat: "Fries & sides", pps: 1, price: "40.00" },
    { sku: "GULAMAN", name: "Gulaman drink", cat: "Beverages", pps: 1, price: "15.00" },
    { sku: "SOFTDRINK", name: "Softdrink in cup", cat: "Beverages", pps: 1, price: "20.00" },
    { sku: "BOTTLED-WATER", name: "Bottled water", cat: "Beverages", pps: 1, price: "15.00" },
  ] as const;

  const productIds = new Map<string, string>();
  for (const p of products) {
    const categoryId = categoryIds.get(p.cat)!;
    const row = await db.product.upsert({
      where: { companyId_sku: { companyId, sku: p.sku } },
      update: { name: p.name, piecesPerStick: String(p.pps), categoryId },
      create: {
        ...co,
        sku: p.sku,
        name: p.name,
        categoryId,
        sellingUnit: p.pps > 1 ? "STICK" : "PIECE",
        piecesPerStick: String(p.pps),
      },
    });
    productIds.set(p.sku, row.id);
  }

  // ------------------------------------------------------------- price list
  const priceList = await db.priceList.upsert({
    where: { companyId_name: { companyId, name: "Company price list" } },
    update: {},
    create: {
      ...co,
      name: "Company price list",
      scopeType: "COMPANY",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    },
  });

  for (const p of products) {
    const productId = productIds.get(p.sku)!;
    await db.priceListItem.upsert({
      where: { priceListId_productId: { priceListId: priceList.id, productId } },
      update: {}, // never overwrite a price the owner has adjusted
      create: { ...co, priceListId: priceList.id, productId, pricePerStick: p.price },
    });
  }

  // --------------------------------------------------------- the standard set
  const set = await db.setDefinition.upsert({
    where: { companyId_code: { companyId, code: "STD-SET" } },
    update: {},
    create: {
      ...co,
      code: "STD-SET",
      name: "Standard Cart Set",
      incentiveAmount: "250", // TODO_OWNER: confirm the peso value of one full set
      completionMode: "PER_COMPONENT",
      maxSetsPerComponent: null,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      notes: "50 sticks each of the five core products — 250 sticks, 1,300 pieces.",
    },
  });

  for (const sku of ["KWEK", "CALAMARES", "SQUIDBALL", "FISHBALL", "KIKIAM-BIG"] as const) {
    const productId = productIds.get(sku)!;
    await db.setComponent.upsert({
      where: { setDefinitionId_productId: { setDefinitionId: set.id, productId } },
      update: { requiredSticks: "50" },
      create: { ...co, setDefinitionId: set.id, productId, requiredSticks: "50" },
    });
  }

  // ------------------------------------------------------------------- carts
  const branches = await db.branch.findMany({ where: { companyId } });
  const br01 = branches.find((b) => b.code === "BR-01")!;
  const br02 = branches.find((b) => b.code === "BR-02")!;

  const carts = [
    { code: "CART-001", name: "Morayta Cart 1", branchId: br01.id, location: "University Belt — Morayta", type: "FOOD_CART" as const, target: "4500" },
    { code: "CART-002", name: "Morayta Cart 2", branchId: br01.id, location: "University Belt — Morayta", type: "FOOD_CART" as const, target: "4000" },
    { code: "CART-003", name: "Recto Station Cart", branchId: br01.id, location: "Recto LRT Station", type: "FOOD_CART" as const, target: "5000" },
    { code: "CART-004", name: "Divisoria Cart", branchId: br01.id, location: "Divisoria Market", type: "MOTOR_CART" as const, target: "5500" },
    { code: "CART-005", name: "Ortigas Cart", branchId: br02.id, location: "Ortigas Office Strip", type: "FOOD_CART" as const, target: "4200" },
    { code: "CART-006", name: "Cainta Factory Cart", branchId: br02.id, location: "Cainta Industrial Park", type: "MOTOR_CART" as const, target: "4800" },
    { code: "CART-007", name: "Antipolo Market Cart", branchId: br02.id, location: "Antipolo Public Market", type: "FOOD_CART" as const, target: "3800" },
    { code: "CART-008", name: "Riverbanks Kiosk", branchId: br02.id, location: "Marikina Riverbanks", type: "KIOSK" as const, target: "3500" },
  ];

  const cartIds = new Map<string, string>();
  for (const cart of carts) {
    const row = await db.cart.upsert({
      where: { companyId_code: { companyId, code: cart.code } },
      update: { name: cart.name, branchId: cart.branchId },
      create: {
        ...co,
        code: cart.code,
        name: cart.name,
        type: cart.type,
        branchId: cart.branchId,
        locationId: locationIds.get(cart.location) ?? null,
        dailySalesTarget: cart.target,
      },
    });
    cartIds.set(cart.code, row.id);
  }

  // --------------------------------------------------------------- employees
  const hired = new Date("2026-03-02T00:00:00.000Z");
  const staff = [
    { no: "EMP-001", first: "Ana", last: "Dela Cruz", position: "Vendor", cart: "CART-001", branchId: br01.id, rate: "500" },
    { no: "EMP-002", first: "Ben", last: "Santos", position: "Vendor", cart: "CART-002", branchId: br01.id, rate: "500" },
    { no: "EMP-003", first: "Carla", last: "Reyes", position: "Vendor", cart: "CART-003", branchId: br01.id, rate: "500" },
    { no: "EMP-004", first: "Dino", last: "Ramos", position: "Vendor", cart: "CART-004", branchId: br01.id, rate: "550" },
    { no: "EMP-005", first: "Elena", last: "Villanueva", position: "Vendor", cart: "CART-005", branchId: br02.id, rate: "500" },
    { no: "EMP-006", first: "Fidel", last: "Garcia", position: "Vendor", cart: "CART-006", branchId: br02.id, rate: "550" },
    { no: "EMP-007", first: "Grace", last: "Mendoza", position: "Vendor", cart: "CART-007", branchId: br02.id, rate: "500" },
    { no: "EMP-008", first: "Hector", last: "Lim", position: "Vendor", cart: "CART-008", branchId: br02.id, rate: "500" },
    { no: "EMP-009", first: "Ivy", last: "Bautista", position: "Branch Supervisor", cart: null, branchId: br01.id, rate: "800" },
    { no: "EMP-010", first: "Jomar", last: "Torres", position: "Branch Supervisor", cart: null, branchId: br02.id, rate: "800" },
  ];

  for (const person of staff) {
    const isVendor = person.position === "Vendor";
    const employee = await db.employee.upsert({
      where: { companyId_employeeNo: { companyId, employeeNo: person.no } },
      update: {
        firstName: person.first,
        lastName: person.last,
        position: person.position,
        mobile: `0917 555 0${person.no.slice(-3)}`,
        // Existing rows predate the two-scheme split, so re-point them.
        compensationSchemeId: isVendor ? scheme.id : flatScheme.id,
      },
      create: {
        ...co,
        employeeNo: person.no,
        firstName: person.first,
        lastName: person.last,
        mobile: `0917 555 0${person.no.slice(-3)}`,
        position: person.position,
        dateHired: hired,
        employmentStatus: "REGULAR",
        branchId: person.branchId,
        cartId: person.cart ? cartIds.get(person.cart) ?? null : null,
        dailyRate: person.rate,
        compensationSchemeId: isVendor ? scheme.id : flatScheme.id,
      },
    });

    const hasEvent = await db.employmentEvent.findFirst({ where: { employeeId: employee.id, type: "HIRED" } });
    if (!hasEvent) {
      await db.employmentEvent.create({
        data: {
          ...co,
          employeeId: employee.id,
          type: "HIRED",
          effectiveDate: hired,
          details: { position: person.position, dailyRate: person.rate },
        },
      });
    }

    // The cart's usual vendor, so opening a shift pre-selects the right person.
    if (person.cart) {
      await db.cart.update({
        where: { id: cartIds.get(person.cart)! },
        data: { defaultVendorId: employee.id },
      });
    }
  }

  return {
    locations: locations.length,
    suppliers: suppliers.length,
    ingredients: ingredients.length,
    products: products.length,
    carts: carts.length,
    employees: staff.length,
  };
}
