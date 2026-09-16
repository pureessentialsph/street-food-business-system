import { revalidatePath } from "next/cache";
import type { ZodSchema } from "zod";
import { requireUser } from "@/lib/auth";
import { scopedDb, writeAudit, type ScopedDb } from "@/lib/db";
import { assertPermission, ForbiddenError, type Permission, type SessionUser } from "@/lib/rbac";

/** What every server action returns. Never throw at the form; show the operator a message. */
export type ActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

type Ctx = { user: SessionUser; db: ScopedDb };

export async function withPermission(permission: Permission): Promise<Ctx> {
  const user = await requireUser();
  assertPermission(user, permission);
  return { user, db: scopedDb(user.companyId) };
}

/** Turn any thrown error into something an operator can act on. */
export function toActionError(error: unknown): ActionResult {
  if (error instanceof ForbiddenError) return { ok: false, error: error.message };

  const message = error instanceof Error ? error.message : String(error);

  // Prisma unique-constraint violation: say which value collided, not "P2002".
  if (message.includes("Unique constraint failed")) {
    const field = /\(`?(\w+)`?\)/.exec(message)?.[1] ?? "value";
    return {
      ok: false,
      error: `That ${field.replace(/Id$/, "")} is already used. Codes must be unique within the company.`,
    };
  }
  if (message.includes("Foreign key constraint")) {
    return { ok: false, error: "That record is still referenced by something else and cannot be removed." };
  }
  if (message.startsWith("Cross-tenant")) {
    return { ok: false, error: "That record belongs to another company." };
  }
  console.error("[action]", error);
  return { ok: false, error: "Something went wrong. Nothing was saved." };
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
