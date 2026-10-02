import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/lib/db";
import { dec } from "@/lib/money";
import { balanceOf, summarise, type CashMovementType, type CashSummary } from "@/lib/engines/cash-book";

/**
 * Posting to the cash book, and reading what is in it.
 *
 * Everything that moves cash calls `postFromDocument` — closing a shift, approving a
 * cash expense, paying a payroll run. It is keyed on the document, so calling it twice
 * for the same shift updates one row instead of doubling the money.
 */

type Tx = Prisma.TransactionClient;

export type DocumentPosting = {
  type: CashMovementType;
  refType: string;
  refId: string;
  amount: string;
  businessDate: Date;
  note: string;
  branchId?: string | null;
};

/**
 * One row per document, always equal to what the document currently says.
 *
 * A zero amount removes the row rather than leaving ₱0.00 in the book: a shift that
 * remitted nothing, or an expense switched off cash, should not appear as a line in a
 * list of where the money went.
 */
export async function postFromDocument(
  db: ScopedDb | (Tx & { $companyId?: string }),
  companyId: string,
  posting: DocumentPosting,
  userId: string | null,
): Promise<void> {
  const client = db as unknown as ScopedDb;
  const amount = dec(posting.amount);
  const where = {
    companyId_refType_refId: {
      companyId,
      refType: posting.refType,
      refId: posting.refId,
    },
  };

  if (amount.isZero()) {
    await client.cashMovement.deleteMany({
      where: { companyId, refType: posting.refType, refId: posting.refId },
    });
    return;
  }

  await client.cashMovement.upsert({
    where,
    update: {
      type: posting.type,
      amount: amount.abs().toFixed(4),
      businessDate: posting.businessDate,
      note: posting.note,
      branchId: posting.branchId ?? null,
    },
    create: {
      companyId,
      type: posting.type,
      amount: amount.abs().toFixed(4),
      businessDate: posting.businessDate,
      refType: posting.refType,
      refId: posting.refId,
      note: posting.note,
      branchId: posting.branchId ?? null,
      createdById: userId,
    },
  });
}

/** Take a document's row back out — an expense rejected, a shift cancelled. */
export async function unpostDocument(
  db: ScopedDb,
  companyId: string,
  refType: string,
  refId: string,
): Promise<void> {
  await db.cashMovement.deleteMany({ where: { companyId, refType, refId } });
}

export type CashPosition = {
  balance: string;
  summary: CashSummary;
  /** Null until the box has been counted at least once. */
  lastCount: { businessDate: string; counted: string; variance: string } | null;
};

export async function cashPosition(
  db: ScopedDb,
  options: { asOf?: Date; branchId?: string | null } = {},
): Promise<CashPosition> {
  const movements = await db.cashMovement.findMany({
    where: {
      ...(options.asOf ? { businessDate: { lte: options.asOf } } : {}),
      ...(options.branchId !== undefined ? { branchId: options.branchId } : {}),
    },
    select: { type: true, amount: true },
  });

  const rows = movements.map((m) => ({ type: m.type as CashMovementType, amount: m.amount.toString() }));
  const lastCount = await db.cashCountSession.findFirst({
    orderBy: [{ businessDate: "desc" }, { createdAt: "desc" }],
  });

  return {
    balance: balanceOf(rows).toFixed(2),
    summary: summarise(rows),
    lastCount: lastCount
      ? {
          businessDate: lastCount.businessDate.toISOString().slice(0, 10),
          counted: lastCount.counted.toFixed(2),
          variance: lastCount.variance.toFixed(2),
        }
      : null,
  };
}
