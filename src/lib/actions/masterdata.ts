"use server";

import {
  branchSchema, cartSchema, compensationSchemeSchema, employeeSchema, ingredientSchema,
  locationSchema, priceListItemSchema, productCategorySchema, productSchema,
  setComponentSchema, setDefinitionSchema, supplierSchema,
} from "@/lib/validation/masterdata";
import { assertScope } from "@/lib/rbac";
import type { ScopedDb } from "@/lib/db";
import { describeChanges, recomputeForIngredient } from "@/lib/costing-service";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

/**
 * Master-data mutations. Each one: check permission, validate, scope, write, audit.
 * The scoped client injects companyId, so no action here writes a company id by hand.
 */

const nullable = (v: string | undefined) => (v === undefined || v === "" ? null : v);

/**
 * A job title typed into the employee form is kept, so the next hire can pick it from
 * the list. Failing to remember it must never fail the save — the employee matters,
 * the lookup row is a convenience.
 */
async function rememberPosition(ctx: { db: ScopedDb }, name: string): Promise<void> {
  try {
    await ctx.db.position.upsert({
      where: { companyId_name: { companyId: ctx.db.$companyId, name } },
      update: { isActive: true },
      create: { companyId: ctx.db.$companyId, name },
    });
  } catch (error) {
    console.error("[rememberPosition]", error);
  }
}

// --------------------------------------------------------------------- branches
export async function saveBranch(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(branchSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = { ...parsed.data, areaId: nullable(parsed.data.areaId), address: nullable(parsed.data.address) };

    if (id) {
      const before = await ctx.db.branch.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That branch no longer exists." };
      const after = await ctx.db.branch.update({ where: { id }, data });
      await audit(ctx, "UPDATE", "Branch", id, before, after);
      refresh("/branches", "/dashboard");
      return { ok: true, id, message: `${after.code} saved.` };
    }

    const created = await ctx.db.branch.create({ data: { ...data, companyId: ctx.db.$companyId } });
    await audit(ctx, "CREATE", "Branch", created.id, null, created);
    refresh("/branches", "/dashboard");
    return { ok: true, id: created.id, message: `${created.code} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// -------------------------------------------------------------------- locations
export async function saveLocation(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(locationSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = {
      ...parsed.data,
      address: nullable(parsed.data.address),
      notes: nullable(parsed.data.notes),
    };

    if (id) {
      const before = await ctx.db.location.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That location no longer exists." };
      const after = await ctx.db.location.update({ where: { id }, data });
      await audit(ctx, "UPDATE", "Location", id, before, after);
      refresh("/locations");
      return { ok: true, id, message: `${after.name} saved.` };
    }
    const created = await ctx.db.location.create({ data: { ...data, companyId: ctx.db.$companyId } });
    await audit(ctx, "CREATE", "Location", created.id, null, created);
    refresh("/locations");
    return { ok: true, id: created.id, message: `${created.name} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// ------------------------------------------------------------------------ carts
export async function saveCart(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(cartSchema, formData);
    if (!parsed.ok) return parsed.result;

    // A supervisor may only place carts in a branch they are scoped to (spec §4).
    assertScope(ctx.user, parsed.data.branchId);

    const data = {
      ...parsed.data,
      locationId: nullable(parsed.data.locationId),
      defaultVendorId: nullable(parsed.data.defaultVendorId),
      dailySalesTarget: parsed.data.dailySalesTarget ?? null,
    };

    if (id) {
      const before = await ctx.db.cart.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That cart no longer exists." };
      const after = await ctx.db.cart.update({ where: { id }, data });
      await audit(ctx, "UPDATE", "Cart", id, before, after);
      refresh("/carts", "/dashboard");
      return { ok: true, id, message: `${after.code} saved.` };
    }
    const created = await ctx.db.cart.create({ data: { ...data, companyId: ctx.db.$companyId } });
    await audit(ctx, "CREATE", "Cart", created.id, null, created);
    refresh("/carts", "/dashboard");
    return { ok: true, id: created.id, message: `${created.code} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// -------------------------------------------------------------------- suppliers
export async function saveSupplier(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(supplierSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = {
      ...parsed.data,
      contactPerson: nullable(parsed.data.contactPerson),
      mobile: nullable(parsed.data.mobile),
      address: nullable(parsed.data.address),
      paymentTerms: nullable(parsed.data.paymentTerms),
    };

    if (id) {
      const before = await ctx.db.supplier.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That supplier no longer exists." };
      const after = await ctx.db.supplier.update({ where: { id }, data });
      await audit(ctx, "UPDATE", "Supplier", id, before, after);
      refresh("/suppliers");
      return { ok: true, id, message: `${after.name} saved.` };
    }
    const created = await ctx.db.supplier.create({ data: { ...data, companyId: ctx.db.$companyId } });
    await audit(ctx, "CREATE", "Supplier", created.id, null, created);
    refresh("/suppliers");
    return { ok: true, id: created.id, message: `${created.name} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// ------------------------------------------------------------------ ingredients
export async function saveIngredient(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(ingredientSchema, formData);
    if (!parsed.ok) return parsed.result;

    if (id) {
      const before = await ctx.db.ingredient.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That ingredient no longer exists." };
      const after = await ctx.db.ingredient.update({ where: { id }, data: parsed.data });

      // A cost change is history, not an overwrite (spec §6). Phase 2 turns this into
      // new ProductCostVersion rows for every affected recipe.
      if (!before.currentCostPerBaseUnit.equals(after.currentCostPerBaseUnit)) {
        await ctx.db.ingredientCostHistory.create({
          data: {
            companyId: ctx.db.$companyId,
            ingredientId: id,
            costPerBaseUnit: after.currentCostPerBaseUnit,
            effectiveFrom: new Date(),
            source: "MANUAL",
          },
        });
      }
      await audit(ctx, "UPDATE", "Ingredient", id, before, after);

      // A price change ripples: every product whose recipe uses this ingredient gets a
      // fresh cost snapshot, and the operator is told what it did to their margins
      // rather than finding out at month end (spec §6).
      let costNote = "";
      if (!before.currentCostPerBaseUnit.equals(after.currentCostPerBaseUnit)) {
        const changes = await recomputeForIngredient(
          ctx.db, id, ctx.user.id, `${after.name} cost changed`,
        );
        if (changes.length > 0) costNote = ` ${describeChanges(changes)}`;
        refresh("/costing");
      }

      refresh("/ingredients");
      return { ok: true, id, message: `${after.name} saved.${costNote}` };
    }

    const created = await ctx.db.ingredient.create({
      data: { ...parsed.data, companyId: ctx.db.$companyId },
    });
    await ctx.db.ingredientCostHistory.create({
      data: {
        companyId: ctx.db.$companyId,
        ingredientId: created.id,
        costPerBaseUnit: created.currentCostPerBaseUnit,
        effectiveFrom: new Date(),
        source: "MANUAL",
      },
    });
    await audit(ctx, "CREATE", "Ingredient", created.id, null, created);
    refresh("/ingredients");
    return { ok: true, id: created.id, message: `${created.name} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// ------------------------------------------------------------------- categories
export async function saveProductCategory(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(productCategorySchema, formData);
    if (!parsed.ok) return parsed.result;

    if (id) {
      const before = await ctx.db.productCategory.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That category no longer exists." };
      const after = await ctx.db.productCategory.update({ where: { id }, data: parsed.data });
      await audit(ctx, "UPDATE", "ProductCategory", id, before, after);
      refresh("/products");
      return { ok: true, id, message: `${after.name} saved.` };
    }
    const created = await ctx.db.productCategory.create({
      data: { ...parsed.data, companyId: ctx.db.$companyId },
    });
    await audit(ctx, "CREATE", "ProductCategory", created.id, null, created);
    refresh("/products");
    return { ok: true, id: created.id, message: `${created.name} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// --------------------------------------------------------------------- products
export async function saveProduct(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(productSchema, formData);
    if (!parsed.ok) return parsed.result;

    if (id) {
      const before = await ctx.db.product.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That product no longer exists." };
      const after = await ctx.db.product.update({ where: { id }, data: parsed.data });
      await audit(ctx, "UPDATE", "Product", id, before, after);
      refresh("/products", "/price-list", "/sets");
      return { ok: true, id, message: `${after.name} saved.` };
    }
    const created = await ctx.db.product.create({
      data: { ...parsed.data, companyId: ctx.db.$companyId },
    });
    await audit(ctx, "CREATE", "Product", created.id, null, created);
    refresh("/products", "/price-list", "/sets");
    return { ok: true, id: created.id, message: `${created.name} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// ------------------------------------------------------------------- price list
export async function savePrice(priceListId: string, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(priceListItemSchema, formData);
    if (!parsed.ok) return parsed.result;

    const list = await ctx.db.priceList.findUnique({ where: { id: priceListId } });
    if (!list) return { ok: false, error: "That price list no longer exists." };

    const existing = await ctx.db.priceListItem.findFirst({
      where: { priceListId, productId: parsed.data.productId },
    });

    const after = existing
      ? await ctx.db.priceListItem.update({
          where: { id: existing.id },
          data: { pricePerStick: parsed.data.pricePerStick },
        })
      : await ctx.db.priceListItem.create({
          data: { ...parsed.data, priceListId, companyId: ctx.db.$companyId },
        });

    await audit(ctx, existing ? "UPDATE" : "CREATE", "PriceListItem", after.id, existing, after);
    refresh("/price-list");
    return { ok: true, id: after.id, message: "Price saved." };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------- compensation
export async function saveCompensationScheme(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("company.manage");
    const parsed = parseForm(compensationSchemeSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = {
      ...parsed.data,
      description: nullable(parsed.data.description),
      maxShortageDeduction: parsed.data.maxShortageDeduction ?? null,
    };

    if (id) {
      const before = await ctx.db.compensationScheme.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That scheme no longer exists." };
      const after = await ctx.db.compensationScheme.update({ where: { id }, data });
      await audit(ctx, "UPDATE", "CompensationScheme", id, before, after);
      refresh("/settings/compensation");
      return { ok: true, id, message: `${after.name} saved.` };
    }
    const created = await ctx.db.compensationScheme.create({
      data: { ...data, companyId: ctx.db.$companyId },
    });
    await audit(ctx, "CREATE", "CompensationScheme", created.id, null, created);
    refresh("/settings/compensation");
    return { ok: true, id: created.id, message: `${created.name} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// -------------------------------------------------------------------- employees
export async function saveEmployee(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    const parsed = parseForm(employeeSchema, formData);
    if (!parsed.ok) return parsed.result;

    if (parsed.data.branchId) assertScope(ctx.user, parsed.data.branchId);

    const data = {
      ...parsed.data,
      dateHired: new Date(`${parsed.data.dateHired}T00:00:00.000Z`),
      middleName: nullable(parsed.data.middleName),
      email: nullable(parsed.data.email),
      address: nullable(parsed.data.address),
      emergencyContactName: nullable(parsed.data.emergencyContactName),
      emergencyContactNo: nullable(parsed.data.emergencyContactNo),
      branchId: nullable(parsed.data.branchId),
      cartId: nullable(parsed.data.cartId),
      compensationSchemeId: nullable(parsed.data.compensationSchemeId),
      supervisorId: nullable(parsed.data.supervisorId),
    };

    if (id) {
      const before = await ctx.db.employee.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That employee no longer exists." };
      const after = await ctx.db.employee.update({ where: { id }, data });

      // Employment history is a record, not a diff you have to reconstruct later.
      if (!before.dailyRate.equals(after.dailyRate)) {
        await ctx.db.employmentEvent.create({
          data: {
            companyId: ctx.db.$companyId,
            employeeId: id,
            type: "RATE_CHANGE",
            effectiveDate: new Date(),
            details: { from: before.dailyRate.toString(), to: after.dailyRate.toString() },
          },
        });
      }
      if (before.branchId !== after.branchId) {
        await ctx.db.employmentEvent.create({
          data: {
            companyId: ctx.db.$companyId,
            employeeId: id,
            type: "TRANSFERRED",
            effectiveDate: new Date(),
            details: { from: before.branchId, to: after.branchId },
          },
        });
      }
      await rememberPosition(ctx, after.position);
      await audit(ctx, "UPDATE", "Employee", id, before, after);
      refresh("/employees");
      return { ok: true, id, message: `${after.firstName} ${after.lastName} saved.` };
    }

    const created = await ctx.db.employee.create({ data: { ...data, companyId: ctx.db.$companyId } });
    await rememberPosition(ctx, created.position);
    await ctx.db.employmentEvent.create({
      data: {
        companyId: ctx.db.$companyId,
        employeeId: created.id,
        type: "HIRED",
        effectiveDate: created.dateHired,
        details: { position: created.position, dailyRate: created.dailyRate.toString() },
      },
    });
    await audit(ctx, "CREATE", "Employee", created.id, null, created);
    refresh("/employees");
    return { ok: true, id: created.id, message: `${created.firstName} ${created.lastName} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

// ------------------------------------------------------------------------- sets
export async function saveSetDefinition(id: string | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("company.manage");
    const parsed = parseForm(setDefinitionSchema, formData);
    if (!parsed.ok) return parsed.result;
    const data = {
      ...parsed.data,
      notes: nullable(parsed.data.notes),
      effectiveFrom: new Date(`${parsed.data.effectiveFrom}T00:00:00.000Z`),
      maxSetsPerComponent: parsed.data.maxSetsPerComponent
        ? Number(parsed.data.maxSetsPerComponent)
        : null,
    };

    if (id) {
      const before = await ctx.db.setDefinition.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That set no longer exists." };
      const after = await ctx.db.setDefinition.update({ where: { id }, data });
      await audit(ctx, "UPDATE", "SetDefinition", id, before, after);
      refresh("/sets");
      return { ok: true, id, message: `${after.code} saved.` };
    }
    const created = await ctx.db.setDefinition.create({
      data: { ...data, companyId: ctx.db.$companyId },
    });
    await audit(ctx, "CREATE", "SetDefinition", created.id, null, created);
    refresh("/sets");
    return { ok: true, id: created.id, message: `${created.code} created.` };
  } catch (error) {
    return toActionError(error);
  }
}

export async function saveSetComponent(
  setDefinitionId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("company.manage");
    const parsed = parseForm(setComponentSchema, formData);
    if (!parsed.ok) return parsed.result;

    const existing = await ctx.db.setComponent.findFirst({
      where: { setDefinitionId, productId: parsed.data.productId },
    });
    const after = existing
      ? await ctx.db.setComponent.update({
          where: { id: existing.id },
          data: { requiredSticks: parsed.data.requiredSticks },
        })
      : await ctx.db.setComponent.create({
          data: { ...parsed.data, setDefinitionId, companyId: ctx.db.$companyId },
        });

    await audit(ctx, existing ? "UPDATE" : "CREATE", "SetComponent", after.id, existing, after);
    refresh("/sets");
    return { ok: true, id: after.id, message: "Component saved." };
  } catch (error) {
    return toActionError(error);
  }
}

export async function removeSetComponent(id: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("company.manage");
    const before = await ctx.db.setComponent.findUnique({ where: { id } });
    if (!before) return { ok: false, error: "That component is already gone." };
    await ctx.db.setComponent.delete({ where: { id } });
    await audit(ctx, "DELETE", "SetComponent", id, before, null);
    refresh("/sets");
    return { ok: true, message: "Component removed." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Master data is archived, never deleted: a cart or product with shift history must
 * still resolve on old reports (spec §3 rule 3 in spirit).
 */
export async function setActive(
  entity: "branch" | "location" | "cart" | "supplier" | "ingredient" | "product" | "employee",
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.write");
    if (entity === "cart") {
      const before = await ctx.db.cart.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That cart no longer exists." };
      const after = await ctx.db.cart.update({
        where: { id },
        data: { status: isActive ? "ACTIVE" : "RETIRED" },
      });
      await audit(ctx, "ARCHIVE", "Cart", id, before, after);
    } else {
      const table = ctx.db[entity] as unknown as {
        findUnique: (a: unknown) => Promise<unknown>;
        update: (a: unknown) => Promise<unknown>;
      };
      const before = await table.findUnique({ where: { id } });
      if (!before) return { ok: false, error: "That record no longer exists." };
      const after = await table.update({ where: { id }, data: { isActive } });
      await audit(ctx, "ARCHIVE", entity, id, before, after);
    }
    refresh("/branches", "/locations", "/carts", "/suppliers", "/ingredients", "/products", "/employees");
    return { ok: true, message: isActive ? "Restored." : "Archived." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Hard delete, for genuine mistakes — a cart created with a typo this morning.
 *
 * Refuses the moment a record has dependents, because deleting one would either orphan
 * history or silently blank a field on a record that still matters. The operator is told
 * exactly what is in the way and pointed at Archive, which is the right answer for
 * anything that has ever traded.
 */
type DeletableEntity =
  | "branch" | "location" | "cart" | "supplier" | "ingredient" | "product" | "employee";

export async function deleteRecord(
  entity: DeletableEntity,
  id: string,
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("masterdata.delete");
    const db = ctx.db;

    const blockers: string[] = [];
    let label = id;
    let before: unknown = null;

    const count = (n: number, one: string, many = `${one}s`) =>
      `${n} ${n === 1 ? one : many}`;

    switch (entity) {
      case "branch": {
        const row = await db.branch.findUnique({
          where: { id },
          include: { _count: { select: { carts: true, employees: true } } },
        });
        if (!row) return { ok: false, error: "That branch no longer exists." };
        before = row;
        label = row.code;
        if (row._count.carts) blockers.push(count(row._count.carts, "cart"));
        if (row._count.employees) blockers.push(count(row._count.employees, "employee"));
        break;
      }
      case "location": {
        const row = await db.location.findUnique({
          where: { id },
          include: { _count: { select: { carts: true } } },
        });
        if (!row) return { ok: false, error: "That location no longer exists." };
        before = row;
        label = row.name;
        if (row._count.carts) blockers.push(count(row._count.carts, "cart"));
        break;
      }
      case "cart": {
        const row = await db.cart.findUnique({
          where: { id },
          include: { _count: { select: { assignedStaff: true } } },
        });
        if (!row) return { ok: false, error: "That cart no longer exists." };
        before = row;
        label = row.code;
        if (row._count.assignedStaff) {
          blockers.push(`${count(row._count.assignedStaff, "employee")} assigned to it`);
        }
        break;
      }
      case "supplier": {
        const row = await db.supplier.findUnique({
          where: { id },
          include: { _count: { select: { ingredients: true } } },
        });
        if (!row) return { ok: false, error: "That supplier no longer exists." };
        before = row;
        label = row.name;
        // Supplier-ingredient links are just a price book; they go with the supplier.
        break;
      }
      case "ingredient": {
        const row = await db.ingredient.findUnique({ where: { id } });
        if (!row) return { ok: false, error: "That ingredient no longer exists." };
        before = row;
        label = row.name;
        // Recipe lines arrive in Phase 2 and must be added as a blocker here.
        break;
      }
      case "product": {
        const row = await db.product.findUnique({
          where: { id },
          include: { _count: { select: { setComponents: true, priceListItems: true } } },
        });
        if (!row) return { ok: false, error: "That product no longer exists." };
        before = row;
        label = row.name;
        if (row._count.setComponents) {
          blockers.push(`${count(row._count.setComponents, "set")} that includes it`);
        }
        break;
      }
      case "employee": {
        const row = await db.employee.findUnique({
          where: { id },
          include: { _count: { select: { logins: true, cartsDefaulted: true, reports: true } } },
        });
        if (!row) return { ok: false, error: "That employee no longer exists." };
        before = row;
        label = `${row.firstName} ${row.lastName}`;
        if (row._count.logins) blockers.push(`${count(row._count.logins, "user login")}`);
        if (row._count.cartsDefaulted) {
          blockers.push(`${count(row._count.cartsDefaulted, "cart")} where they are the usual vendor`);
        }
        if (row._count.reports) blockers.push(`${count(row._count.reports, "direct report")}`);
        break;
      }
    }

    if (blockers.length > 0) {
      return {
        ok: false,
        error: `${label} still has ${blockers.join(" and ")}. Reassign those first, or use Archive to take it out of use while keeping its history.`,
      };
    }

    // Audit BEFORE the row disappears, so the deletion itself leaves a trace.
    await audit(ctx, "DELETE", entity, id, before, null);

    switch (entity) {
      case "branch": await db.branch.delete({ where: { id } }); break;
      case "location": await db.location.delete({ where: { id } }); break;
      case "cart": await db.cart.delete({ where: { id } }); break;
      case "supplier": await db.supplier.delete({ where: { id } }); break;
      case "ingredient": await db.ingredient.delete({ where: { id } }); break;
      case "product": await db.product.delete({ where: { id } }); break;
      case "employee": await db.employee.delete({ where: { id } }); break;
    }

    refresh("/branches", "/locations", "/carts", "/suppliers", "/ingredients", "/products", "/employees", "/price-list", "/sets");
    return { ok: true, message: `${label} deleted.` };
  } catch (error) {
    return toActionError(error);
  }
}
