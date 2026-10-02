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
  | "user.manage"
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
  | "cash.manage"
  | "procurement.approve"
  | "employee.read"
  | "employee.documents"
  | "pay.readAll"
  | "cost.read"
  | "reports.read";

const PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>([
    "company.manage", "user.manage", "masterdata.write", "masterdata.delete", "costing.write", "inventory.write",
    "shift.open", "shift.close", "shift.approve", "payroll.run", "payroll.approve",
    "expense.write", "expense.approve", "cash.manage", "procurement.approve", "employee.read",
    "employee.documents", "pay.readAll", "cost.read", "reports.read",
  ]),
  ADMIN: new Set<Permission>([
    "user.manage", "masterdata.write", "masterdata.delete", "costing.write", "inventory.write", "shift.open", "shift.close",
    "shift.approve", "payroll.run", "payroll.approve", "expense.write", "expense.approve",
    "cash.manage", "procurement.approve", "employee.read", "employee.documents", "pay.readAll",
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

/**
 * Roles rank, and nobody may hand out a rank above their own. Without this an ADMIN —
 * who can manage logins — could simply create an OWNER and inherit the company.
 * OWNER is the only role that can mint another OWNER.
 */
const ROLE_RANK: Record<Role, number> = {
  OWNER: 100,
  ADMIN: 80,
  AREA_MANAGER: 60,
  SUPERVISOR: 40,
  COMMISSARY: 30,
  HR: 30,
  VENDOR: 10,
};

export function canAssignRole(actor: SessionUser, role: Role): boolean {
  return ROLE_RANK[role] <= ROLE_RANK[actor.role];
}

/** Roles a given actor is allowed to offer in the role dropdown. */
export function assignableRoles(actor: SessionUser): Role[] {
  return (Object.keys(ROLE_RANK) as Role[])
    .filter((role) => canAssignRole(actor, role))
    .sort((a, b) => ROLE_RANK[b] - ROLE_RANK[a]);
}

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
/**
 * Segregation of duties on a shift: the person who closed it records the counts that
 * set a vendor's pay, so someone else signs it off.
 *
 * `allowSelfApproval` lifts that, and exists because a one-person operation has no
 * second pair of eyes — a control nobody can satisfy does not protect anything, it
 * just stops the day being signed off. It is off by default and should go back off as
 * soon as there is someone else to approve. Self-approval leaves closedById and
 * approvedById equal on the shift, so it is visible wherever the shift is read.
 *
 * The same setting lifts the matching rule on expenses — see assertCanApproveExpense.
 */
export function assertCanApproveShift(
  user: SessionUser,
  shift: { closedById: string | null; status: string },
  options?: { allowSelfApproval?: boolean },
): void {
  assertPermission(user, "shift.approve");
  if (shift.closedById && shift.closedById === user.id && !options?.allowSelfApproval) {
    throw new ForbiddenError(
      "A shift cannot be approved by the user who closed it. Ask an area manager, owner, or admin — " +
      "or, if you are the only one who can approve, turn on self-approval in Settings.",
    );
  }
}

/**
 * The same rule on an expense: whoever recorded it should not be the one waving it
 * through, since recording it is what puts it in the P&L.
 *
 * It shares `Company.allowSelfApproval` with the shift rule rather than having a switch
 * of its own. The reason either is ever turned on is the same one — there is nobody
 * else — and asking an owner to say twice that they work alone would be noise. A
 * self-approved expense records the same person as recorder and approver.
 *
 * Approving a payroll run deliberately has no such escape: it is the point where money
 * leaves, and it is the one approval worth stopping for.
 */
export function assertCanApproveExpense(
  user: SessionUser,
  expense: { createdById: string | null },
  options?: { allowSelfApproval?: boolean },
): void {
  assertPermission(user, "expense.approve");
  if (expense.createdById && expense.createdById === user.id && !options?.allowSelfApproval) {
    throw new ForbiddenError(
      "You recorded this expense, so someone else has to approve it. If you are the only one " +
      "who can approve, turn on self-approval in Settings.",
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
  { href: "/cash", label: "Cash", permission: "cash.manage" },
  { href: "/procurement", label: "Procurement", permission: "procurement.approve" },
  { href: "/reports", label: "P&L", permission: "reports.read" },
  { href: "/users", label: "Logins", permission: "user.manage" },
  { href: "/settings", label: "Settings", permission: "company.manage" },
  { href: "/guide", label: "Guide" },
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
