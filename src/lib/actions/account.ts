"use server";

import bcrypt from "bcryptjs";
import { requireUser } from "@/lib/auth";
import { rawDb, scopedDb, writeAudit } from "@/lib/db";
import { checkNewPassword, PASSWORD_MESSAGES } from "@/lib/password";
import { toActionError, type ActionResult } from "./helpers";

/**
 * Changing your own password.
 *
 * Uses rawDb deliberately: this reads and writes the signed-in account by its own id,
 * which the session already proves, and User carries no companyId filter worth scoping
 * here beyond that id.
 */
export async function changeOwnPassword(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();

    const current = String(formData.get("currentPassword") ?? "");
    const next = String(formData.get("newPassword") ?? "");
    const confirm = String(formData.get("confirmPassword") ?? "");

    if (!current) {
      return {
        ok: false,
        error: "Enter your current password.",
        fieldErrors: { currentPassword: ["Required"] },
      };
    }

    const account = await rawDb.user.findUnique({ where: { id: user.id } });
    if (!account) return { ok: false, error: "That account no longer exists." };

    /**
     * Verify the current password before changing anything. Without this, anyone who
     * picks up an unlocked laptop owns the account permanently — a session that expires
     * in hours becomes a password that does not.
     */
    if (!(await bcrypt.compare(current, account.passwordHash))) {
      return {
        ok: false,
        error: "That is not your current password.",
        fieldErrors: { currentPassword: ["Does not match"] },
      };
    }

    const problem = checkNewPassword({ next, confirm, current });
    if (problem) {
      return {
        ok: false,
        error: PASSWORD_MESSAGES[problem],
        fieldErrors: { newPassword: [PASSWORD_MESSAGES[problem]] },
      };
    }

    const changedAt = new Date();
    await rawDb.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(next, 10), passwordChangedAt: changedAt },
    });

    /**
     * Audited, but nothing about the password itself is recorded — not the old one, not
     * the new one, not either hash. That a change happened is the useful fact.
     */
    await writeAudit(scopedDb(user.companyId), {
      userId: user.id,
      action: "UPDATE",
      entity: "User",
      entityId: user.id,
      before: { passwordChangedAt: account.passwordChangedAt },
      after: { passwordChangedAt: changedAt },
    });

    return {
      ok: true,
      message:
        "Password changed. Every other device signed in as you has been signed out — " +
        "sign in again here with the new one.",
    };
  } catch (error) {
    return toActionError(error);
  }
}
