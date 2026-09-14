import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Tenant-scoped database access (spec §3 rule 8, §15.1).
 *
 * NOTHING in the app may touch a bare PrismaClient. `scopedDb(companyId)` returns a
 * client that injects companyId into every read filter and every written row, so a
 * forgotten `where` clause cannot leak another operator's data. The MVP runs one
 * company; this is what makes selling the system to the second one a config change.
 *
 * Models with no companyId column (Company itself) pass through untouched.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Unscoped client. Only for auth lookups, seeding and migrations. */
export const rawDb: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = rawDb;

/** Models carrying a companyId column, read from the generated datamodel at startup. */
const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "companyId"))
    .map((model) => model.name),
);

export function isTenantModel(model: string | undefined): boolean {
  return model !== undefined && TENANT_MODELS.has(model);
}

const WHERE_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
]);

type AnyArgs = Record<string, unknown>;

function withCompanyWhere(args: AnyArgs, companyId: string): AnyArgs {
  const existing = (args.where ?? {}) as AnyArgs;
  if (typeof existing.companyId === "string" && existing.companyId !== companyId) {
    throw new Error(
      `Cross-tenant query blocked: asked for companyId ${existing.companyId} in the scope of ${companyId}`,
    );
  }
  return { ...args, where: { ...existing, companyId } };
}

function withCompanyData(args: AnyArgs, companyId: string): AnyArgs {
  const data = args.data;
  if (Array.isArray(data)) {
    return { ...args, data: data.map((row) => ({ ...(row as AnyArgs), companyId })) };
  }
  if (data && typeof data === "object") {
    return { ...args, data: { ...(data as AnyArgs), companyId } };
  }
  return args;
}

/**
 * A Prisma client locked to one company.
 *
 * Known limitation, documented on purpose: nested writes (`create: { branch: { create } }`)
 * are NOT rewritten. Create parents and children as separate scoped calls, or inside
 * `scoped.$transaction`. Phase 1 adds a lint rule for nested create/connectOrCreate.
 */
export function scopedDb(companyId: string) {
  if (!companyId) throw new Error("scopedDb requires a companyId");

  return rawDb.$extends({
    name: `tenant:${companyId}`,
    client: {
      /**
       * The company this client is locked to. Pass it explicitly in `create` data so the
       * generated types stay honest; the query extension below overwrites it regardless,
       * so a wrong value cannot be written.
       */
      $companyId: companyId,
    },
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isTenantModel(model)) return query(args);

          let next = (args ?? {}) as AnyArgs;

          if (WHERE_OPS.has(operation)) next = withCompanyWhere(next, companyId);

          if (operation === "create" || operation === "createMany" || operation === "update" || operation === "updateMany") {
            next = withCompanyData(next, companyId);
          }

          if (operation === "upsert") {
            next = withCompanyWhere(next, companyId);
            const create = (next.create ?? {}) as AnyArgs;
            const update = (next.update ?? {}) as AnyArgs;
            next = {
              ...next,
              create: { ...create, companyId },
              update: { ...update, companyId },
            };
          }

          return query(next as never);
        },
      },
    },
  });
}

export type ScopedDb = ReturnType<typeof scopedDb>;

/** Every mutation writes one of these (spec §3 rule 5). */
export async function writeAudit(
  db: ScopedDb,
  input: {
    userId: string | null;
    action: string;
    entity: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db.auditLog.create({
    data: {
      companyId: db.$companyId,
      userId: input.userId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      before: (input.before ?? null) as Prisma.InputJsonValue,
      after: (input.after ?? null) as Prisma.InputJsonValue,
    },
  });
}
