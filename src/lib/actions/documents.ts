"use server";

import { z } from "zod";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

/**
 * 201 file documents (spec §6). Restricted to OWNER, ADMIN and HR, and every read of
 * the list is written to the audit log — an employee's records are not browsing material.
 */

const documentSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum([
    "CONTRACT", "ID", "CLEARANCE", "HEALTH_CERT", "TRAINING",
    "PERFORMANCE", "DISCIPLINARY", "GOVT_RECORD", "OTHER",
  ]),
  title: z.string().trim().min(2, "Give the document a title").max(120),
  fileRef: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

const toDate = (value?: string) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

export async function saveEmployeeDocument(
  id: string | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("employee.documents");
    const parsed = parseForm(documentSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = parsed.data;

    const payload = {
      employeeId: data.employeeId,
      type: data.type,
      title: data.title,
      fileRef: data.fileRef ?? null,
      issuedAt: toDate(data.issuedAt),
      expiresAt: toDate(data.expiresAt),
      notes: data.notes ?? null,
    };

    if (id) {
      const before = await ctx.db.employeeDocument.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That document record no longer exists." };
      const after = await ctx.db.employeeDocument.update({ where: { id }, data: payload });
      await audit(ctx, "UPDATE", "EmployeeDocument", id, before, after);
      refresh(`/employees/${data.employeeId}/documents`);
      return { ok: true, id, message: `${after.title} saved.` };
    }

    const created = await ctx.db.employeeDocument.create({
      data: { ...payload, companyId: ctx.db.$companyId, uploadedById: ctx.user.id },
    });
    await audit(ctx, "CREATE", "EmployeeDocument", created.id, null, created);
    refresh(`/employees/${data.employeeId}/documents`);
    return { ok: true, id: created.id, message: `${created.title} recorded.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteEmployeeDocument(id: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("employee.documents");
    const before = await ctx.db.employeeDocument.findUnique({ where: { id } });
    if (!before) return { ok: false, error: "That document record is already gone." };

    await audit(ctx, "DELETE", "EmployeeDocument", id, before, null);
    await ctx.db.employeeDocument.delete({ where: { id } });
    refresh(`/employees/${before.employeeId}/documents`);
    return { ok: true, message: "Document record removed." };
  } catch (error) {
    return toActionError(error);
  }
}

/** Log that someone opened an employee's 201 file (spec §4). */
export async function logDocumentAccess(employeeId: string): Promise<void> {
  try {
    const ctx = await withPermission("employee.documents");
    await audit(ctx, "UPDATE", "EmployeeDocumentAccess", employeeId, null, {
      viewedAt: new Date().toISOString(),
    });
  } catch {
    // Never let an audit write break the page the user asked for.
  }
}

const eventSchema = z.object({
  employeeId: z.string().min(1),
  type: z.enum([
    "HIRED", "REGULARIZED", "TRANSFERRED", "PROMOTED",
    "RATE_CHANGE", "SUSPENDED", "SEPARATED",
  ]),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  note: z.string().trim().max(300).optional().or(z.literal("").transform(() => undefined)),
});

export async function recordEmploymentEvent(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("employee.documents");
    const parsed = parseForm(eventSchema, formData);
    if (!parsed.ok) return parsed.result;

    const created = await ctx.db.employmentEvent.create({
      data: {
        companyId: ctx.db.$companyId,
        employeeId: parsed.data.employeeId,
        type: parsed.data.type,
        effectiveDate: toDate(parsed.data.effectiveDate)!,
        details: { note: parsed.data.note ?? null, recordedBy: ctx.user.name },
      },
    });
    await audit(ctx, "CREATE", "EmploymentEvent", created.id, null, created);
    refresh(`/employees/${parsed.data.employeeId}/documents`, `/employees/${parsed.data.employeeId}`);
    return { ok: true, message: `${parsed.data.type.replace("_", " ").toLowerCase()} recorded.` };
  } catch (error) {
    return toActionError(error);
  }
}
