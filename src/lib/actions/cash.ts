"use server";

import { z } from "zod";
import { dec } from "@/lib/money";
import { decimalString } from "@/lib/validation/masterdata";
import { toDateColumn } from "@/lib/businessDate";
import { cashPosition } from "@/lib/cash-service";
import {
  DENOMINATIONS, MANUAL_TYPES, TYPE_LABELS, countCash, denominationTotal, signedAmount,
  type CashMovementType,
} from "@/lib/engines/cash-book";
import { audit, parseForm, refresh, toActionError, withPermission, type ActionResult } from "./helpers";

/**
 * The cash book (spec §7, extended): capital in, drawings out, and counting the box.
 *
 * Rows posted from a shift, an expense or a payroll run are not editable here — they
 * belong to those documents and are corrected there. What an owner enters by hand is
 * the money that has no document of its own.
 */

const movementSchema = z.object({
  type: z.enum(MANUAL_TYPES as [CashMovementType, ...CashMovementType[]]),
  amount: decimalString("Amount"),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  note: z.string().trim().min(3, "Say what this was, in a few words").max(200),
});

export async function recordCashMovement(formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await withPermission("cash.manage");
    const parsed = parseForm(movementSchema, formData);
    if (!parsed.ok) return parsed.result;
    const { type, amount, businessDate, note } = parsed.data;

    if (!dec(amount).abs().greaterThan(0)) {
      return { ok: false, error: "A movement of nothing is not a movement." };
    }

    const created = await ctx.db.cashMovement.create({
      data: {
        companyId: ctx.db.$companyId,
        type,
        amount: dec(amount).abs().toFixed(4),
        businessDate: toDateColumn(businessDate),
        note,
        createdById: ctx.user.id,
      },
    });

    await audit(ctx, "CREATE", "CashMovement", created.id, null, created);
    refresh("/cash", "/dashboard");

    const effect = signedAmount({ type, amount });
    return {
      ok: true,
      id: created.id,
      message:
        `${TYPE_LABELS[type]}: ₱${dec(amount).abs().toFixed(2)} ` +
        `${effect.isNegative() ? "out of" : "into"} the cash box.`,
    };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Corrections are reversals, never edits — the same rule the inventory ledger follows,
 * for the same reason: a cash book you can quietly rewrite proves nothing.
 */
export async function reverseCashMovement(id: string, reason: string): Promise<ActionResult> {
  try {
    const ctx = await withPermission("cash.manage");
    if (reason.trim().length < 5) {
      return { ok: false, error: "Say why in a few words — this stays on the record." };
    }

    const original = await ctx.db.cashMovement.findUnique({ where: { id } });
    if (!original) return { ok: false, error: "That entry no longer exists." };
    if (original.refType) {
      return {
        ok: false,
        error:
          `This line comes from the ${original.refType === "CartShift" ? "shift" : original.refType.toLowerCase()} ` +
          `it belongs to, so correct it there and this will follow.`,
      };
    }
    if (original.reversesId) {
      return { ok: false, error: "That entry is itself a correction. Record a new movement instead." };
    }
    const already = await ctx.db.cashMovement.findFirst({ where: { reversesId: id } });
    if (already) return { ok: false, error: "That entry has already been reversed." };

    /**
     * The opposite type, so the reversal reads as what it is in a list of movements
     * rather than as a negative amount nobody notices.
     */
    const OPPOSITE: Partial<Record<CashMovementType, CashMovementType>> = {
      CAPITAL: "OWNER_DRAW",
      OWNER_DRAW: "CAPITAL",
      BANK_DEPOSIT: "BANK_WITHDRAWAL",
      BANK_WITHDRAWAL: "BANK_DEPOSIT",
      OTHER_IN: "OTHER_OUT",
      OTHER_OUT: "OTHER_IN",
      PURCHASE: "OTHER_IN",
    };
    const type = OPPOSITE[original.type as CashMovementType] ?? "OTHER_IN";

    const reversal = await ctx.db.cashMovement.create({
      data: {
        companyId: ctx.db.$companyId,
        type,
        amount: original.amount,
        businessDate: original.businessDate,
        note: `Reversing: ${original.note} — ${reason.trim()}`,
        reversesId: original.id,
        createdById: ctx.user.id,
      },
    });

    await audit(ctx, "CREATE", "CashMovement", reversal.id, null, reversal);
    refresh("/cash", "/dashboard");
    return { ok: true, message: "Reversed. Both the original and the correction stay on the record." };
  } catch (error) {
    return toActionError(error);
  }
}

/**
 * Count the box against the book.
 *
 * The count is recorded whether or not it agrees. Writing the difference off is a
 * second, explicit decision — a count that silently adjusted itself to match the book
 * would make counting pointless.
 */
export async function recordCashCount(
  counts: { denomination: number; count: number }[],
  options: { businessDate: string; note?: string; writeOff: boolean },
): Promise<ActionResult> {
  try {
    const ctx = await withPermission("cash.manage");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.businessDate)) {
      return { ok: false, error: "Pick a date for the count." };
    }
    const known = new Set<number>(DENOMINATIONS);
    for (const line of counts) {
      if (!known.has(line.denomination)) return { ok: false, error: "That is not a peso denomination." };
      if (!Number.isInteger(line.count) || line.count < 0) {
        return { ok: false, error: "Count notes and coins in whole numbers." };
      }
    }

    const counted = denominationTotal(counts);
    const position = await cashPosition(ctx.db);
    const outcome = countCash(position.balance, counted.toFixed(4));

    if (outcome.needsExplaining && !options.note?.trim() && !options.writeOff) {
      return {
        ok: false,
        error: `${outcome.verdict} Say what you think happened before recording it.`,
      };
    }

    const businessDate = toDateColumn(options.businessDate);
    const session = await ctx.db.cashCountSession.create({
      data: {
        companyId: ctx.db.$companyId,
        businessDate,
        expected: dec(outcome.expected).toFixed(4),
        counted: dec(outcome.counted).toFixed(4),
        variance: dec(outcome.variance).toFixed(4),
        denominations: counts.filter((line) => line.count > 0),
        note: options.note?.trim() || null,
        createdById: ctx.user.id,
      },
    });

    /**
     * Writing off brings the book to what was actually counted. The adjustment carries
     * its own sign, points at the count that caused it, and is never automatic.
     */
    let adjusted = false;
    if (options.writeOff && !dec(outcome.variance).isZero()) {
      const adjustment = await ctx.db.cashMovement.create({
        data: {
          companyId: ctx.db.$companyId,
          type: "COUNT_ADJUSTMENT",
          amount: dec(outcome.variance).toFixed(4),
          businessDate,
          refType: "CashCountSession",
          refId: session.id,
          note: `Counted difference written off — ${outcome.verdict}${options.note ? ` ${options.note.trim()}` : ""}`,
          createdById: ctx.user.id,
        },
      });
      await ctx.db.cashCountSession.update({
        where: { id: session.id },
        data: { adjustmentId: adjustment.id },
      });
      adjusted = true;
    }

    await audit(ctx, "CREATE", "CashCountSession", session.id, null, session);
    refresh("/cash", "/dashboard");
    return {
      ok: true,
      id: session.id,
      message:
        `Counted ₱${outcome.counted} against ₱${outcome.expected} in the book. ${outcome.verdict}` +
        (adjusted ? " The book now matches the box." : ""),
    };
  } catch (error) {
    return toActionError(error);
  }
}
