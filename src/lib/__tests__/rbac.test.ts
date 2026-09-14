import { describe, expect, it } from "vitest";
import {
  assertCanApproveShift,
  assertScope,
  can,
  canAccessBranch,
  ForbiddenError,
  navFor,
  seesAllBranches,
  type SessionUser,
} from "../rbac";

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "u1",
    companyId: "c1",
    email: "user@sfs.local",
    name: "Test User",
    role: "SUPERVISOR",
    employeeId: null,
    scopeBranchIds: ["b1"],
    ...overrides,
  };
}

describe("rbac", () => {
  it("gives the owner everything and the vendor nothing", () => {
    const owner = user({ role: "OWNER", scopeBranchIds: [] });
    expect(can(owner, "company.manage")).toBe(true);
    expect(seesAllBranches(owner)).toBe(true);

    const vendor = user({ role: "VENDOR" });
    expect(can(vendor, "shift.close")).toBe(false);
    expect(can(vendor, "cost.read")).toBe(false);
    expect(navFor(vendor).map((n) => n.href)).toEqual(["/dashboard"]);
  });

  it("shows an owner and a supervisor different navigation", () => {
    const ownerNav = navFor(user({ role: "OWNER" })).map((n) => n.href);
    const supervisorNav = navFor(user({ role: "SUPERVISOR" })).map((n) => n.href);
    expect(ownerNav).toContain("/settings");
    expect(supervisorNav).not.toContain("/settings");
    expect(supervisorNav).toContain("/shifts");
    expect(ownerNav.length).toBeGreaterThan(supervisorNav.length);
  });

  it("confines a supervisor to their own branch", () => {
    const supervisor = user({ scopeBranchIds: ["b1"] });
    expect(canAccessBranch(supervisor, "b1")).toBe(true);
    expect(canAccessBranch(supervisor, "b2")).toBe(false);
    expect(() => assertScope(supervisor, "b2")).toThrow(ForbiddenError);
  });

  it("never lets the closer approve their own shift (segregation of duties)", () => {
    const manager = user({ id: "m1", role: "AREA_MANAGER" });
    expect(() =>
      assertCanApproveShift(manager, { closedById: "m1", status: "CLOSED" }),
    ).toThrow(/cannot be approved by the user who closed it/);

    expect(() =>
      assertCanApproveShift(manager, { closedById: "s1", status: "CLOSED" }),
    ).not.toThrow();
  });

  it("does not let a supervisor approve at all, even another supervisor's shift", () => {
    expect(() =>
      assertCanApproveShift(user({ role: "SUPERVISOR" }), { closedById: "other", status: "CLOSED" }),
    ).toThrow(ForbiddenError);
  });

  it("hides pay and cost from roles that must not see them", () => {
    expect(can(user({ role: "SUPERVISOR" }), "pay.readAll")).toBe(false);
    expect(can(user({ role: "SUPERVISOR" }), "cost.read")).toBe(false);
    expect(can(user({ role: "HR" }), "pay.readAll")).toBe(true);
    expect(can(user({ role: "HR" }), "shift.close")).toBe(false);
  });
});
