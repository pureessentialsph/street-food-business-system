import { revalidatePath } from "next/cache";
import type { ZodSchema } from "zod";
import { requireUser } from "@/lib/auth";
import { scopedDb, writeAudit, type ScopedDb } from "@/lib/db";
import { assertPermission, type Permission, type SessionUser } from "@/lib/rbac";
import { toActionError, type ActionResult } from "./errors";

export { toActionError };
export type { ActionResult };

type Ctx = { user: SessionUser; db: ScopedDb };

export async function withPermission(permission: Permission): Promise<Ctx> {
  const user = await requireUser();
  assertPermission(user, permission);
  return { user, db: scopedDb(user.companyId) };
}

export function parseForm<T>(
  schema: ZodSchema<T>,
  formData: FormData,
): { ok: true; data: T } | { ok: false; result: ActionResult } {
  const raw: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$")) continue; // framework fields
    raw[key] = value instanceof File ? undefined : value;
  }
  /**
   * Checkboxes send "on" when ticked and, paired with their hidden field, "false" when
   * not. The last value for a name wins above, so this only has to turn the string into
   * a boolean — and anything that is not an affirmative is false.
   */
  for (const key of ["isActive", "deductShortage", "isPreferred", "isOverhead"]) {
    if (key in raw) raw[key] = raw[key] === "on" || raw[key] === "true";
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      result: {
        ok: false,
        error: "Please correct the highlighted fields.",
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }
  return { ok: true, data: parsed.data };
}

/** Every mutation writes an AuditLog row (spec §3 rule 5). */
export async function audit(
  ctx: Ctx,
  action: "CREATE" | "UPDATE" | "DELETE" | "ARCHIVE",
  entity: string,
  entityId: string,
  before: unknown,
  after: unknown,
): Promise<void> {
  await writeAudit(ctx.db, {
    userId: ctx.user.id,
    action,
    entity,
    entityId,
    before,
    after,
  });
}

export function refresh(...paths: string[]): void {
  for (const path of paths) revalidatePath(path);
}
