import { describe, expect, it } from "vitest";
import type { Role } from "@prisma/client";
import { assignableRoles, can, canAssignRole, type SessionUser } from "../rbac";

const actor = (role: Role): SessionUser => ({
  id: "u1", companyId: "c1", email: "a@b.c", name: "A", role,
  employeeId: null, scopeBranchIds: [],
});

/**
 * Managing logins is the one screen where a bug hands the company away. An admin who
 * can create an owner has, in effect, made themselves one.
 */
describe("who may manage logins", () => {
  it("lets owners and admins in", () => {
    expect(can(actor("OWNER"), "user.manage")).toBe(true);
    expect(can(actor("ADMIN"), "user.manage")).toBe(true);
  });

  it("keeps everyone else out", () => {
    for (const role of ["AREA_MANAGER", "SUPERVISOR", "COMMISSARY", "HR", "VENDOR"] as Role[]) {
      expect(can(actor(role), "user.manage")).toBe(false);
    }
  });
});

describe("nobody hands out a rank above their own", () => {
  it("lets an owner create any role, owner included", () => {
    for (const role of ["OWNER", "ADMIN", "AREA_MANAGER", "SUPERVISOR", "COMMISSARY", "HR", "VENDOR"] as Role[]) {
      expect(canAssignRole(actor("OWNER"), role)).toBe(true);
    }
  });

  it("stops an admin minting an owner — that would be taking the company", () => {
    expect(canAssignRole(actor("ADMIN"), "OWNER")).toBe(false);
  });

  it("lets an admin create anything at or below admin", () => {
    for (const role of ["ADMIN", "AREA_MANAGER", "SUPERVISOR", "COMMISSARY", "HR", "VENDOR"] as Role[]) {
      expect(canAssignRole(actor("ADMIN"), role)).toBe(true);
    }
  });

  it("offers only the roles the actor may actually assign", () => {
    expect(assignableRoles(actor("OWNER"))).toContain("OWNER");
    expect(assignableRoles(actor("ADMIN"))).not.toContain("OWNER");
    expect(assignableRoles(actor("ADMIN"))[0]).toBe("ADMIN");
  });

  it("ranks highest first, so the dropdown reads top-down", () => {
    const roles = assignableRoles(actor("OWNER"));
    expect(roles[0]).toBe("OWNER");
    expect(roles[roles.length - 1]).toBe("VENDOR");
  });

  it("lets a supervisor assign nothing above themselves either", () => {
    expect(canAssignRole(actor("SUPERVISOR"), "ADMIN")).toBe(false);
    expect(canAssignRole(actor("SUPERVISOR"), "SUPERVISOR")).toBe(true);
  });
});
