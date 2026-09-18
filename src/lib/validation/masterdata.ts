import { z } from "zod";

/**
 * Every input boundary is a Zod schema (spec §3). Money and quantities arrive from HTML
 * inputs as strings and stay strings all the way to Prisma's Decimal — parsing them into
 * JS numbers first would be the float bug the spec forbids.
 */

const DECIMAL_RE = /^-?\d{1,10}(\.\d{1,4})?$/;

export const decimalString = (label: string, { min = 0, allowZero = true } = {}) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(DECIMAL_RE, `${label} must be a number with at most 4 decimal places`)
    .refine((v) => {
      const n = Number(v);
      return allowZero ? n >= min : n > min;
    }, `${label} must be ${allowZero ? `at least ${min}` : `greater than ${min}`}`);

/**
 * Blank is allowed and means "not set"; a number must not be negative. optionalDecimal-
 * String alone would accept "-50" — DECIMAL_RE permits a leading minus — and an
 * incentive that subtracts money is never what anyone meant to type.
 */
export const optionalNonNegativeDecimal = (label: string) =>
  z
    .string()
    .trim()
    .regex(DECIMAL_RE, `${label} must be a number`)
    .refine((v) => Number(v) >= 0, `${label} cannot be negative`)
    .optional()
    .or(z.literal("").transform(() => undefined));

export const optionalDecimalString = (label: string) =>
  z
    .string()
    .trim()
    .regex(DECIMAL_RE, `${label} must be a number`)
    .optional()
    .or(z.literal("").transform(() => undefined));

const code = z
  .string()
  .trim()
  .min(2, "Code must be at least 2 characters")
  .max(20, "Code must be 20 characters or fewer")
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use capitals, digits and hyphens, e.g. BR-01")
  .transform((v) => v.toUpperCase());

const name = z.string().trim().min(2, "Name is required").max(120);
const optionalText = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal("").transform(() => undefined));
const id = z.string().trim().min(1);
const optionalId = id.optional().or(z.literal("").transform(() => undefined));
const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker");

export const branchSchema = z.object({
  code,
  name,
  type: z.enum(["BRANCH", "COMMISSARY", "WAREHOUSE"]),
  areaId: optionalId,
  address: optionalText,
  isActive: z.coerce.boolean().default(true),
});

export const locationSchema = z.object({
  name,
  type: z.enum([
    "SCHOOL", "OFFICE", "FACTORY", "TERMINAL",
    "MARKET", "RESIDENTIAL", "COMMERCIAL", "OTHER",
  ]),
  address: optionalText,
  notes: optionalText,
  isActive: z.coerce.boolean().default(true),
});

export const cartSchema = z.object({
  code,
  name,
  type: z.enum(["FOOD_CART", "MOTOR_CART", "KIOSK"]),
  branchId: id,
  locationId: optionalId,
  status: z.enum(["ACTIVE", "IDLE", "MAINTENANCE", "RETIRED"]),
  defaultVendorId: optionalId,
  dailySalesTarget: optionalDecimalString("Daily sales target"),
});

export const supplierSchema = z.object({
  name,
  contactPerson: optionalText,
  mobile: optionalText,
  address: optionalText,
  leadTimeDays: z.coerce.number().int().min(0, "Lead time cannot be negative").max(365),
  paymentTerms: optionalText,
  isActive: z.coerce.boolean().default(true),
});

export const ingredientSchema = z.object({
  sku: code,
  name,
  category: z.enum(["RAW", "PACKAGING", "CONDIMENT", "OIL", "CONSUMABLE"]),
  baseUnit: z.enum(["G", "ML", "PC"]),
  currentCostPerBaseUnit: decimalString("Cost per base unit"),
  minStock: decimalString("Minimum stock"),
  safetyStock: decimalString("Safety stock"),
  packSize: decimalString("Pack size", { min: 0, allowZero: false }),
  isActive: z.coerce.boolean().default(true),
});

export const productCategorySchema = z.object({
  name,
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
  isActive: z.coerce.boolean().default(true),
});

export const productSchema = z.object({
  sku: code,
  name,
  categoryId: id,
  sellingUnit: z.enum(["PIECE", "STICK"]),
  // The heart of the unit ladder: zero would divide by zero everywhere downstream.
  piecesPerStick: decimalString("Pieces per stick", { min: 0, allowZero: false }),
  isActive: z.coerce.boolean().default(true),
});

export const priceListItemSchema = z.object({
  productId: id,
  pricePerStick: decimalString("Price per stick", { min: 0, allowZero: false }),
});

/**
 * Company settings. `code` and `currency` are deliberately absent: the code is what a
 * user types at sign-in to tell two operators with the same email apart, and every
 * money figure already written is denominated in the currency — neither can be changed
 * after the fact without rewriting history.
 */
export const companySchema = z.object({
  name,
  timezone: z
    .string()
    .trim()
    .min(1, "Timezone is required")
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Not a timezone this system recognises, e.g. Asia/Manila"),
  businessDayCutoffHour: z
    .string()
    .trim()
    .regex(/^\d{1,2}$/, "Hour must be a whole number")
    .refine((v) => Number(v) >= 0 && Number(v) <= 23, "Hour must be between 0 and 23"),
  cashVarianceThreshold: decimalString("Cash variance threshold"),
  defaultWastagePct: optionalNonNegativeDecimal("Default wastage %"),
});

/**
 * An asset is equipment, not stock: it is not consumed by selling, so it never touches
 * the inventory ledger. Location is optional because a thing can sit unassigned in the
 * office before anyone takes it out to a cart.
 */
export const assetSchema = z.object({
  tag: code,
  name,
  category: z.enum([
    "COOKING_EQUIPMENT", "CART_VEHICLE", "CONTAINER",
    "UTENSIL", "FURNITURE", "ELECTRONICS", "OTHER",
  ]),
  serialNo: optionalText,
  acquiredOn: isoDate,
  acquisitionCost: decimalString("Acquisition cost"),
  supplierId: optionalId,
  condition: z.enum(["GOOD", "NEEDS_REPAIR", "UNSERVICEABLE"]),
  status: z.enum(["IN_USE", "IN_STORAGE", "IN_REPAIR", "RETIRED", "LOST"]),
  locationType: z.enum(["WAREHOUSE", "BRANCH", "CART", "EMPLOYEE"]).optional()
    .or(z.literal("").transform(() => undefined)),
  locationId: optionalId,
  notes: optionalText,
});

/** Moving one asset somewhere else. The reason is what makes the history worth having. */
export const assetAssignmentSchema = z.object({
  locationType: z.enum(["WAREHOUSE", "BRANCH", "CART", "EMPLOYEE"]).optional()
    .or(z.literal("").transform(() => undefined)),
  locationId: optionalId,
  movedOn: isoDate,
  reason: optionalText,
});

export const compensationSchemeSchema = z.object({
  name,
  baseDailyRate: decimalString("Base daily rate"),
  deductShortage: z.coerce.boolean().default(true),
  maxShortageDeduction: optionalDecimalString("Maximum shortage deduction"),
  description: optionalText,
  isActive: z.coerce.boolean().default(true),
});

export const employeeSchema = z.object({
  employeeNo: code,
  firstName: z.string().trim().min(1, "First name is required").max(60),
  middleName: z.string().trim().max(60).optional().or(z.literal("").transform(() => undefined)),
  lastName: z.string().trim().min(1, "Last name is required").max(60),
  mobile: z
    .string()
    .trim()
    .min(7, "Mobile number is required")
    .regex(/^[0-9+()\s-]+$/, "Digits, spaces, +, - and () only"),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("").transform(() => undefined)),
  address: optionalText,
  emergencyContactName: optionalText,
  emergencyContactNo: optionalText,
  position: z
    .string()
    .trim()
    .min(2, "Position is required")
    .max(60)
    .refine((v) => v !== "__new__", "Type the new position name"),
  dateHired: isoDate,
  employmentStatus: z.enum(["PROBATIONARY", "REGULAR", "PART_TIME", "CONTRACTUAL", "SEPARATED"]),
  branchId: optionalId,
  cartId: optionalId,
  dailyRate: decimalString("Daily rate"),
  compensationSchemeId: optionalId,
  supervisorId: optionalId,
  isActive: z.coerce.boolean().default(true),
});

export const setComponentSchema = z.object({
  productId: id,
  requiredSticks: decimalString("Required sticks", { min: 0, allowZero: false }),
  /// Blank means "an equal share of the set incentive"; 0 means "earns nothing".
  creditValue: optionalNonNegativeDecimal("Credit worth"),
});

/// One row of the credit-split editor: componentId -> what a credit of it is worth.
export const setCreditSchema = z.object({
  componentId: id,
  creditValue: optionalNonNegativeDecimal("Credit worth"),
});

export const setDefinitionSchema = z.object({
  code,
  name,
  incentiveAmount: decimalString("Incentive amount"),
  completionMode: z.enum(["PER_COMPONENT", "ALL_COMPONENTS", "PROPORTIONAL"]),
  maxSetsPerComponent: z
    .string()
    .trim()
    .regex(/^\d*$/, "Whole number or blank")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  effectiveFrom: isoDate,
  notes: optionalText,
  isActive: z.coerce.boolean().default(true),
});

export type BranchInput = z.infer<typeof branchSchema>;
export type CartInput = z.infer<typeof cartSchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type EmployeeInput = z.infer<typeof employeeSchema>;
export type SetDefinitionInput = z.infer<typeof setDefinitionSchema>;
