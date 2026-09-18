"use server";

import { assetAssignmentSchema, assetSchema } from "@/lib/validation/masterdata";
import type { ScopedDb } from "@/lib/db";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

/**
 * Assets: the durable things a cart needs to trade — fryers, tanks, tongs, the motor
 * cart itself. Deliberately NOT inventory: equipment is not consumed by selling, so it
 * stays out of the stock ledger where it would corrupt counts and cost of goods.
 */

const nullable = (v: string | undefined) => (v === undefined || v === "" ? null : v);

/** A location is a pair. Half of one — a cart id with no type — would be unresolvable. */
function locationPair(
  locationType: string | undefined,
  locationId: string | undefined,
): { ok: true; type: string | null; id: string | null } | { ok: false; error: string } {
  const type = nullable(locationType);
  const id = nullable(locationId);
  if (Boolean(type) !== Boolean(id)) {
    return { ok: false, error: "Choose both where it is and which one — or leave both blank." };
  }
  return { ok: true, type, id };
}

/**
 * A category typed into the asset form is kept, so the next one can pick it from the
 * list. Failing to remember it must never fail the save — the asset matters, the lookup
 * row is a convenience. Mirrors how job titles work on the employee form.
 */
async function rememberCategory(ctx: { db: ScopedDb }, name: string): Promise<void> {
  try {
    await ctx.db.assetCategory.upsert({
      where: { companyId_name: { companyId: ctx.db.$companyId, name } },
      update: { isActive: true },
      create: { companyId: ctx.db.$companyId, name },
    });
  } catch (error) {
    console.error("[rememberCategory]", error);
  }
}

/**
 * A supplier typed rather than chosen. Only a name is known at this point — you are
 * recording a fryer, not onboarding a vendor — so a stub is created and the rest is
 * filled in on /suppliers later. Matching an existing name rather than creating a
 * duplicate is the point: "Caltex LPG Dealer" typed twice is one supplier.
 *
 * Unlike a category, failing here DOES fail the save: the asset would otherwise be
 * written with no supplier at all, silently losing what was typed.
 */
async function resolveSupplier(
  ctx: { db: ScopedDb },
  supplierId: string | null,
  typedName: string | undefined,
): Promise<{ id: string | null; created: string | null }> {
  const name = typedName?.trim();
  if (!name) return { id: supplierId, created: null };

  const existing = await ctx.db.supplier.findFirst({ where: { name } });
  if (existing) return { id: existing.id, created: null };

  const created = await ctx.db.supplier.create({
    data: { companyId: ctx.db.$companyId, name, leadTimeDays: 1 },
  });
  return { id: created.id, created: created.name };
}

export async function saveAsset(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(assetSchema, formData);
    if (!parsed.ok) return parsed.result;

    const where = locationPair(parsed.data.locationType, parsed.data.locationId);
    if (!where.ok) return { ok: false, error: where.error };

    const supplier = await resolveSupplier(
      ctx,
      nullable(parsed.data.supplierId),
      parsed.data.supplierName,
    );

    const { supplierName: _typed, ...fields } = parsed.data;
    const data = {
      ...fields,
      serialNo: nullable(parsed.data.serialNo),
      supplierId: supplier.id,
      notes: nullable(parsed.data.notes),
      acquiredOn: new Date(parsed.data.acquiredOn),
      locationType: where.type as never,
      locationId: where.id,
    };

    await rememberCategory(ctx, parsed.data.category);
    const andSupplier = supplier.created
      ? ` ${supplier.created} was added to suppliers — fill in their contact and lead time on the Suppliers screen.`
      : "";

    if (id) {
      const before = await ctx.db.asset.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That asset no longer exists." };
      const after = await ctx.db.asset.update({ where: { id }, data });

      /**
       * Editing the location on the asset form still writes history. Otherwise the
       * quiet path — correcting the record rather than using Move — would lose exactly
       * the fact the history exists to keep.
       */
      const moved =
        before.locationType !== after.locationType || before.locationId !== after.locationId;
      if (moved) {
        await ctx.db.assetAssignment.create({
          data: {
            companyId: ctx.db.$companyId,
            assetId: id,
            fromLocationType: before.locationType,
            fromLocationId: before.locationId,
            toLocationType: after.locationType,
            toLocationId: after.locationId,
            movedOn: new Date(),
            reason: "Changed on the asset form",
            createdById: ctx.user.id,
          },
        });
      }

      await audit(ctx, "UPDATE", "Asset", id, before, after);
      refresh("/assets", "/carts");
      return { ok: true, id, message: `${after.tag} saved.${andSupplier}` };
    }

    const created = await ctx.db.asset.create({
      data: { ...data, companyId: ctx.db.$companyId, createdById: ctx.user.id },
    });
    if (created.locationId) {
      await ctx.db.assetAssignment.create({
        data: {
          companyId: ctx.db.$companyId,
          assetId: created.id,
          toLocationType: created.locationType,
          toLocationId: created.locationId,
          movedOn: created.acquiredOn,
          reason: "First assignment",
          createdById: ctx.user.id,
        },
      });
    }
    await audit(ctx, "CREATE", "Asset", created.id, null, created);
    refresh("/assets", "/carts");
    return { ok: true, id: created.id, message: `${created.tag} added.${andSupplier}` };
  } catch (error) {
    return toActionError(error);
  }
}

/** Hand an asset to a cart, branch, warehouse or a named person, and record the move. */
export async function assignAsset(assetId: string, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(assetAssignmentSchema, formData);
    if (!parsed.ok) return parsed.result;

    const where = locationPair(parsed.data.locationType, parsed.data.locationId);
    if (!where.ok) return { ok: false, error: where.error };

    const before = await ctx.db.asset.findUnique({ where: { id: assetId } });
    if (!before) return { ok: false, error: "That asset no longer exists." };

    if (before.locationType === where.type && before.locationId === where.id) {
      return { ok: false, error: "That is where it already is." };
    }

    const after = await ctx.db.asset.update({
      where: { id: assetId },
      data: { locationType: where.type as never, locationId: where.id },
    });
    await ctx.db.assetAssignment.create({
      data: {
        companyId: ctx.db.$companyId,
        assetId,
        fromLocationType: before.locationType,
        fromLocationId: before.locationId,
        toLocationType: after.locationType,
        toLocationId: after.locationId,
        movedOn: new Date(parsed.data.movedOn),
        reason: nullable(parsed.data.reason),
        createdById: ctx.user.id,
      },
    });

    await audit(ctx, "UPDATE", "Asset", assetId, before, after);
    refresh("/assets", "/carts");
    return { ok: true, id: assetId, message: `${after.tag} moved.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function deleteAsset(id: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.delete");
    const before = await ctx.db.asset.findUnique({
      where: { id },
      include: { _count: { select: { assignments: true } } },
    });
    if (!before) return { ok: false, error: "That asset no longer exists." };

    /**
     * An asset that has been around long enough to have moved is part of the record.
     * Retiring keeps the history; deleting throws away who was holding what.
     */
    if (before._count.assignments > 1) {
      return {
        ok: false,
        error:
          `${before.tag} has ${before._count.assignments} movements on record. ` +
          `Set its status to Retired or Lost instead — deleting it would throw away ` +
          `who was holding it and when.`,
      };
    }

    await ctx.db.asset.delete({ where: { id } });
    await audit(ctx, "DELETE", "Asset", id, before, null);
    refresh("/assets", "/carts");
    return { ok: true, message: `${before.tag} deleted.` };
  } catch (error) {
    return toActionError(error);
  }
}
