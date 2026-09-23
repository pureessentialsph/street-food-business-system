"use server";

import bcrypt from "bcryptjs";
import type { Role } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { rawDb, scopedDb, writeAudit } from "@/lib/db";
import { checkNewPassword, PASSWORD_MESSAGES } from "@/lib/password";
import { assertPermission, canAssignRole } from "@/lib/rbac";
import { parseForm, refresh, toActionError, type ActionResult } from "./helpers";
import { userSchema } from "@/lib/validation/masterdata";

/**
 * Managing who can sign in.
 *
 * Three ways this goes wrong if it is written carelessly, so each has an explicit
 * guard below: an admin quietly promoting themselves, someone locking themselves out,
 * and the company losing its last owner.
 */

async function context() {
  const actor = await requireUser();
  assertPermission(actor, "user.manage");
  return { actor, db: scopedDb(actor.companyId) };
}

/** Would this leave the company with no active owner able to sign in? */
async function wouldStrandTheCompany(
  companyId: string,
  targetId: string,
  nextRole: Role,
  nextActive: boolean,
): Promise<boolean> {
  if (nextRole === "OWNER" && nextActive) return false;
  const otherOwners = await rawDb.user.count({
    where: { companyId, role: "OWNER", isActive: true, id: { not: targetId } },
  });
  return otherOwners === 0;
}

export async function saveUser(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const { actor, db } = await context();
    const parsed = parseForm(userSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = parsed.data;

    /** Nobody hands out a rank above their own — see canAssignRole. */
    if (!canAssignRole(actor, data.role)) {
      return {
        ok: false,
        error: `You cannot give someone the ${data.role.toLowerCase().replace("_", " ")} role — it is above your own.`,
      };
    }

    /**
     * Belt and braces against the checkbox trap: a single Checkbox emits a hidden
     * "false" so that unticking one means something, and if that ever reaches a group
     * it would be read as a branch id. Keep only ids that name a real branch.
     */
    const known = new Set((await db.branch.findMany({ select: { id: true } })).map((b) => b.id));
    const branchIds = formData.getAll("branchIds").map(String).filter((b) => known.has(b));

    if (id) {
      const before = await db.user.findUnique({ where: { id }, include: { scopes: true } });
      if (!before) return { ok: false, error: "That login no longer exists." };

      if (!canAssignRole(actor, before.role)) {
        return { ok: false, error: "That login outranks you, so you cannot change it." };
      }

      /**
       * You cannot demote or deactivate yourself. An owner who does it by accident has
       * no way back in, and the fix is a database edit.
       */
      if (before.id === actor.id && (data.role !== before.role || !data.isActive)) {
        return {
          ok: false,
          error: "You cannot change your own role or switch your own login off. Ask another owner.",
        };
      }

      if (await wouldStrandTheCompany(db.$companyId, id, data.role, data.isActive ?? true)) {
        return {
          ok: false,
          error: "This is the last active owner. Give someone else the owner role first.",
        };
      }

      const after = await db.user.update({
        where: { id },
        data: { email: data.email, name: data.name, role: data.role, isActive: data.isActive,
                employeeId: data.employeeId || null },
      });

      await db.userBranchScope.deleteMany({ where: { userId: id } });
      if (branchIds.length) {
        await db.userBranchScope.createMany({
          data: branchIds.map((branchId) => ({ companyId: db.$companyId, userId: id, branchId })),
        });
      }

      await writeAudit(db, {
        userId: actor.id, action: "UPDATE", entity: "User", entityId: id,
        before: { ...before, passwordHash: undefined },
        after: { ...after, passwordHash: undefined, branchIds },
      });
      refresh("/users");
      return { ok: true, id, message: `${after.email} saved.` };
    }

    const password = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");
    const problem = checkNewPassword({ next: password, confirm });
    if (problem) {
      return { ok: false, error: PASSWORD_MESSAGES[problem], fieldErrors: { password: [PASSWORD_MESSAGES[problem]] } };
    }

    const created = await db.user.create({
      data: {
        companyId: db.$companyId,
        email: data.email,
        name: data.name,
        role: data.role,
        isActive: data.isActive,
        employeeId: data.employeeId || null,
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    if (branchIds.length) {
      await db.userBranchScope.createMany({
        data: branchIds.map((branchId) => ({ companyId: db.$companyId, userId: created.id, branchId })),
      });
    }

    await writeAudit(db, {
      userId: actor.id, action: "CREATE", entity: "User", entityId: created.id,
      before: null, after: { ...created, passwordHash: undefined, branchIds },
    });
    refresh("/users");
    return {
      ok: true,
      id: created.id,
      message: `${created.email} can now sign in. Tell them the password in person and have them change it on their account page.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** Set someone else's password — the only way back in, since there is no reset email. */
export async function resetUserPassword(id: string, formData: FormData): Promise<ActionResult> {
  try {
    const { actor, db } = await context();

    const target = await db.user.findUnique({ where: { id } });
    if (!target) return { ok: false, error: "That login no longer exists." };
    if (!canAssignRole(actor, target.role)) {
      return { ok: false, error: "That login outranks you, so you cannot reset its password." };
    }

    const next = String(formData.get("password") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");
    const problem = checkNewPassword({ next, confirm });
    if (problem) {
      return { ok: false, error: PASSWORD_MESSAGES[problem], fieldErrors: { password: [PASSWORD_MESSAGES[problem]] } };
    }

    const changedAt = new Date();
    await db.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(next, 10), passwordChangedAt: changedAt },
    });

    /** Nothing about the password is recorded — that it changed is the useful fact. */
    await writeAudit(db, {
      userId: actor.id, action: "UPDATE", entity: "User", entityId: id,
      before: { passwordChangedAt: target.passwordChangedAt },
      after: { passwordChangedAt: changedAt, resetBy: actor.email },
    });

    refresh("/users");
    return {
      ok: true,
      message:
        `${target.email} now signs in with the new password, and is signed out everywhere else. ` +
        `Tell them in person and have them change it themselves.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}
