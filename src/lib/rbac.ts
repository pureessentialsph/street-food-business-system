import type { Role } from "@prisma/client";

/** Roles and what they may do (spec §4). Scope is enforced in the query layer, never the UI. */

export type SessionUser = {
  id: string;
  companyId: string;
  email: string;
  name: string;
  role: Role;
  employeeId: string | null;
  scopeBranchIds: string[];
};

export const ALL_BRANCHES = "*" as const;

/** Roles that see every branch regardless of UserBranchScope rows. */
const COMPANY_WIDE: ReadonlySet<Role> = new Set<Role>(["OWNER", "ADMIN"]);

export type Permission =
  | "company.manage"
  | "masterdata.write"
  | "masterdata.delete"
  | "costing.write"
  | "inventory.write"
  | "shift.open"
  | "shift.close"
  | "shift.approve"
  | "payroll.run"
  | "payroll.approve"
  | "expense.write"
  | "expense.approve"
  | "procurement.approve"
  | "employee.read"
  | "employee.documents"
  | "pay.readAll"
  | "cost.read"
  | "reports.read";

const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>([
    "company.manage", "masterdata.write", "masterdata.delete", "costing.write", "inventory.write",
    "shift.open", "shift.close", "shift.approve", "payroll.run", "payroll.approve",
    "expense.write", "expense.approve", "procurement.approve", "employee.read",
    "employee.documents", "pay.readAll", "cost.read", "reports.read",
  ]),
  ADMIN: new Set<Permission>([
    "masterdata.write", "masterdata.delete", "costing.write", "inventory.write", "shift.open", "shift.close",
    "shift.approve", "payroll.run", "payroll.approve", "expense.write", "expense.approve",
    "procurement.approve", "employee.read", "employee.documents", "pay.readAll",
    "cost.read", "reports.read",
  ]),
  AREA_MANAGER: new Set<Permission>([
    "shift.approve", "payroll.approve", "procurement.approve", "expense.approve",
    "employee.read", "cost.read", "reports.read",
  ]),
  SUPERVISOR: new Set<Permission>([
    "shift.open", "shift.close", "inventory.write", "expense.write", "employee.read",
    "reports.read",
  ]),
  COMMISSARY: new Set<Permission>(["inventory.write", "cost.read", "reports.read"]),
  HR: new Set<Permission>(["employee.read", "employee.documents", "pay.readAll"]),
  VENDOR: new Set<Permission>([]),
};

export function can(user: SessionUser, permission: Permission): boolean {
  return PERMISSIONS[user.role].has(permission);
}

export function assertPermission(user: SessionUser, permission: Permission): void {
  if (!can(user, permission)) {
    throw new ForbiddenError(`${user.role} may not ${permission}`);
  }
}

export function seesAllBranches(user: SessionUser): boolean {
  return COMPANY_WIDE.has(user.role);
}

export function canAccessBranch(user: SessionUser, branchId: string): boolean {
  if (seesAllBranches(user)) return true;
  return user.scopeBranchIds.includes(branchId);
}

/** Call at the top of every server action that touches branch-scoped data (spec §4). */
export function assertScope(user: SessionUser, branchId: string): void {
  if (!canAccessBranch(user, branchId)) {
    throw new ForbiddenError(`${user.email} is not scoped to branch ${branchId}`);
  }
}

/**
 * Segregation of duties (spec §7): the supervisor who records the counts that cut a
 * vendor's pay may never approve that same shift.
 */
export function assertCanApproveShift(
  user: SessionUser,
  shift: { closedById: string | null; status: string },
): void {
  assertPermission(user, "shift.approve");
  if (shift.closedById && shift.closedById === user.id) {
    throw new ForbiddenError(
      "A shift cannot be approved by the user who closed it. Ask an area manager, owner, or admin.",
    );
  }
}

export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Navigation is derived from permissions, so a hidden button is never the only guard. */
export type NavItem = { href: string; label: string; permission?: Permission };

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/shifts", label: "Daily Close", permission: "shift.close" },
  { href: "/carts", label: "Carts", permission: "reports.read" },
  { href: "/branches", label: "Branches", permission: "reports.read" },
  { href: "/locations", label: "Locations", permission: "masterdata.write" },
  { href: "/products", label: "Products", permission: "masterdata.write" },
  { href: "/price-list", label: "Prices", permission: "masterdata.write" },
  { href: "/sets", label: "Sets", permission: "reports.read" },
  { href: "/inventory", label: "Inventory", permission: "inventory.write" },
  { href: "/assets", label: "Assets", permission: "masterdata.write" },
  { href: "/costing", label: "Costing", permission: "cost.read" },
  { href: "/ingredients", label: "Ingredients", permission: "cost.read" },
  { href: "/suppliers", label: "Suppliers", permission: "masterdata.write" },
  { href: "/employees", label: "Employees", permission: "employee.read" },
  { href: "/payroll", label: "Payroll", permission: "payroll.run" },
  { href: "/expenses", label: "Expenses", permission: "expense.write" },
  { href: "/procurement", label: "Procurement", permission: "procurement.approve" },
  { href: "/reports", label: "P&L", permission: "reports.read" },
  { href: "/settings", label: "Settings", permission: "company.manage" },
];

export function navFor(user: SessionUser): NavItem[] {
  return NAV.filter((item) => !item.permission || can(user, item.permission));
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  AREA_MANAGER: "Area Manager",
  SUPERVISOR: "Supervisor",
  COMMISSARY: "Commissary",
  HR: "HR",
  VENDOR: "Vendor",
};
