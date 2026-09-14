import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isTenantModel } from "../db";

/**
 * Needs no database — reads the generated datamodel. This is the guard that keeps the
 * system sellable: the day someone adds a model without companyId, this test fails
 * before the data leak ships (spec §5.1, §15.1).
 */
describe("tenant schema", () => {
  const models = Prisma.dmmf.datamodel.models;
  const EXEMPT = new Set(["Company"]);

  it("puts companyId on every model except Company", () => {
    const missing = models
      .filter((m) => !EXEMPT.has(m.name))
      .filter((m) => !m.fields.some((f) => f.name === "companyId"))
      .map((m) => m.name);
    expect(missing).toEqual([]);
  });

  it("keeps companyId non-null so a row can never be orphaned from its tenant", () => {
    const nullable = models
      .filter((m) => !EXEMPT.has(m.name))
      .filter((m) => m.fields.some((f) => f.name === "companyId" && !f.isRequired))
      .map((m) => m.name);
    expect(nullable).toEqual([]);
  });

  it("scopes every business unique constraint by company", () => {
    // A globally unique business code would collide the moment a second operator signs up.
    const offenders: string[] = [];
    for (const model of models) {
      if (EXEMPT.has(model.name)) continue;
      for (const unique of model.uniqueFields) {
        const scopedByCompany = unique.includes("companyId");
        // Child tables may key off a parent id that is itself company-scoped.
        const scopedByParentId = unique.some((f) => f !== "companyId" && f.endsWith("Id"));
        if (!scopedByCompany && !scopedByParentId) {
          offenders.push(`${model.name}(${unique.join(", ")})`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("recognises which models the scoped client must filter", () => {
    expect(isTenantModel("Branch")).toBe(true);
    expect(isTenantModel("User")).toBe(true);
    expect(isTenantModel("Company")).toBe(false);
    expect(isTenantModel(undefined)).toBe(false);
  });

  it("stores money and quantities as Decimal, never Float", () => {
    const floats = models.flatMap((m) =>
      m.fields.filter((f) => f.type === "Float").map((f) => `${m.name}.${f.name}`),
    );
    expect(floats).toEqual([]);
  });
});
