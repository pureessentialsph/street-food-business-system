import { Decimal, dec, divide, sum, ZERO } from "@/lib/money";
import { setCredits } from "@/lib/units";

/**
 * Compensation engine (spec §8). PURE — no database.
 *
 * Every result line carries the arithmetic in words, so a payslip can say
 * "540 pcs ÷ 10 per stick = 54.0 sticks ÷ 50 required = 1 credit × ₱50.00 = ₱50.00"
 * rather than asking anyone to trust a number.
 */

export type RuleType =
  | "SET_COMPLETION" | "REFILL_BONUS" | "COMMISSION_PCT" | "PER_UNIT" | "TARGET_BONUS" | "ATTENDANCE";

export type CompensationRule = {
  id: string;
  type: RuleType;
  priority: number;
  params: Record<string, unknown>;
  scopeProductId?: string | null;
  scopeCategoryId?: string | null;
};

export type SetComponentInput = {
  productId: string;
  productName: string;
  requiredSticks: Decimal | string | number;
};

export type SetDefinitionInput = {
  code: string;
  incentiveAmount: Decimal | string | number;
  completionMode: "PER_COMPONENT" | "ALL_COMPONENTS" | "PROPORTIONAL";
  maxSetsPerComponent: number | null;
  components: SetComponentInput[];
};

export type PayShiftInput = {
  status: "OPEN" | "CLOSED" | "APPROVED" | "DISPUTED";
  netSales: Decimal | string | number;
  cashVariance: Decimal | string | number;
  vendorAcknowledged: boolean;
  refillCount?: number;
};

export type PayLineInput = {
  productId: string;
  productName?: string;
  categoryId?: string | null;
  sticksSold: Decimal | string | number;
  piecesSold: Decimal | string | number;
};

export type PaySchemeInput = {
  name: string;
  baseDailyRate: Decimal | string | number;
  deductShortage: boolean;
  /** null means uncapped — the owner's confirmed default (spec §15.5). */
  maxShortageDeduction: Decimal | string | number | null;
};

export type ExtraDeduction = {
  type: string;
  amount: Decimal | string | number;
  note?: string;
};

export type PayLine = {
  kind: "BASE" | "INCENTIVE" | "DEDUCTION";
  ruleType: RuleType | "BASE" | string;
  label: string;
  /** The sum in words, exactly as it should read on a payslip. */
  computation: string;
  amount: string;
};

export type PayResult = {
  basePay: string;
  incentiveTotal: string;
  deductionTotal: string;
  netPay: string;
  lines: PayLine[];
  /** Set to true when a shortage was suppressed for want of an acknowledgment. */
  shortageSuppressed: boolean;
  blockedByDispute: boolean;
};

const money = (value: Decimal) => value.toDecimalPlaces(2).toFixed(2);
const peso = (value: Decimal | string | number) => `₱${dec(value).toDecimalPlaces(2).toFixed(2)}`;

function num(params: Record<string, unknown>, key: string, fallback = 0): Decimal {
  const raw = params[key];
  if (raw === undefined || raw === null || raw === "") return dec(fallback);
  return dec(raw as never);
}

/**
 * What one shift earns. Base pay, then each rule in priority order, then deductions.
 */
export function computeShiftPay(input: {
  shift: PayShiftInput;
  lines: PayLineInput[];
  scheme: PaySchemeInput;
  rules: CompensationRule[];
  setDefinition?: SetDefinitionInput | null;
  deductions?: ExtraDeduction[];
}): PayResult {
  const { shift, lines, scheme, rules, setDefinition } = input;
  const payLines: PayLine[] = [];

  // A shift that was never closed earns nothing — there is no count to pay against.
  const worked = shift.status === "CLOSED" || shift.status === "APPROVED" || shift.status === "DISPUTED";

  const basePay = worked ? dec(scheme.baseDailyRate) : ZERO;
  payLines.push({
    kind: "BASE",
    ruleType: "BASE",
    label: "Base daily pay",
    computation: worked
      ? `${scheme.name} — ${peso(scheme.baseDailyRate)} for a closed shift`
      : "Shift not closed — no base pay",
    amount: money(basePay),
  });

  const sticksOf = new Map(lines.map((l) => [l.productId, dec(l.sticksSold)]));
  const netSales = dec(shift.netSales);
  const cashVariance = dec(shift.cashVariance);

  let incentiveTotal = ZERO;
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    switch (rule.type) {
      case "SET_COMPLETION": {
        if (!setDefinition || setDefinition.components.length === 0) break;
        const requireZeroShortage = rule.params.requireZeroShortage === true;
        if (requireZeroShortage && cashVariance.isNegative()) {
          payLines.push({
            kind: "INCENTIVE",
            ruleType: rule.type,
            label: `Set completion — ${setDefinition.code}`,
            computation: `Cash was ${peso(cashVariance.abs())} short and this scheme requires no shortage`,
            amount: "0.00",
          });
          break;
        }

        const share = divide(dec(setDefinition.incentiveAmount), setDefinition.components.length) ?? ZERO;

        if (setDefinition.completionMode === "PER_COMPONENT") {
          for (const component of setDefinition.components) {
            const sticks = sticksOf.get(component.productId) ?? ZERO;
            let credits = setCredits(sticks, component.requiredSticks);
            const capped = setDefinition.maxSetsPerComponent !== null
              && credits > setDefinition.maxSetsPerComponent;
            if (capped) credits = setDefinition.maxSetsPerComponent!;

            const amount = share.times(credits);
            incentiveTotal = incentiveTotal.plus(amount);
            payLines.push({
              kind: "INCENTIVE",
              ruleType: rule.type,
              label: `Set credit — ${component.productName}`,
              computation:
                `${sticks.toFixed(1)} sticks ÷ ${dec(component.requiredSticks).toFixed(0)} required = ` +
                `${credits} credit${credits === 1 ? "" : "s"}${capped ? " (capped)" : ""} × ${peso(share)}`,
              amount: money(amount),
            });
          }
          break;
        }

        // Both remaining modes are decided by the weakest component.
        let weakest: { ratio: Decimal; name: string } | null = null;
        for (const component of setDefinition.components) {
          const sticks = sticksOf.get(component.productId) ?? ZERO;
          const ratio = divide(sticks, dec(component.requiredSticks)) ?? ZERO;
          if (!weakest || ratio.lessThan(weakest.ratio)) {
            weakest = { ratio, name: component.productName };
          }
        }
        if (!weakest) break;

        if (setDefinition.completionMode === "ALL_COMPONENTS") {
          const sets = weakest.ratio.floor();
          const amount = dec(setDefinition.incentiveAmount).times(sets);
          incentiveTotal = incentiveTotal.plus(amount);
          payLines.push({
            kind: "INCENTIVE",
            ruleType: rule.type,
            label: `Set completion — ${setDefinition.code}`,
            computation:
              `Weakest component ${weakest.name} at ${weakest.ratio.toFixed(2)} of a set → ` +
              `${sets.toFixed(0)} full set${sets.equals(1) ? "" : "s"} × ${peso(setDefinition.incentiveAmount)}`,
            amount: money(amount),
          });
        } else {
          const amount = dec(setDefinition.incentiveAmount).times(weakest.ratio);
          incentiveTotal = incentiveTotal.plus(amount);
          payLines.push({
            kind: "INCENTIVE",
            ruleType: rule.type,
            label: `Set completion (proportional) — ${setDefinition.code}`,
            computation:
              `Weakest component ${weakest.name} at ${weakest.ratio.toFixed(2)} × ${peso(setDefinition.incentiveAmount)}`,
            amount: money(amount),
          });
        }
        break;
      }

      case "REFILL_BONUS": {
        const perRefill = num(rule.params, "amountPerRefillSet");
        const minSeq = Number(rule.params.minRefillSeq ?? 2);
        const refills = Math.max((shift.refillCount ?? 0) - (minSeq - 2), 0);
        if (refills <= 0 || perRefill.isZero()) break;
        const amount = perRefill.times(refills);
        incentiveTotal = incentiveTotal.plus(amount);
        payLines.push({
          kind: "INCENTIVE",
          ruleType: rule.type,
          label: "Refill bonus",
          computation: `${refills} refill${refills === 1 ? "" : "s"} × ${peso(perRefill)}`,
          amount: money(amount),
        });
        break;
      }

      case "COMMISSION_PCT": {
        const percent = num(rule.params, "percent");
        if (percent.isZero()) break;
        const amount = netSales.times(percent).dividedBy(100);
        incentiveTotal = incentiveTotal.plus(amount);
        payLines.push({
          kind: "INCENTIVE",
          ruleType: rule.type,
          label: "Commission",
          computation: `${percent.toFixed(2)}% of ${peso(netSales)} net sales`,
          amount: money(amount),
        });
        break;
      }

      case "PER_UNIT": {
        const perUnit = num(rule.params, "amountPerUnit");
        if (perUnit.isZero()) break;
        const scoped = rule.scopeProductId
          ? lines.filter((l) => l.productId === rule.scopeProductId)
          : rule.scopeCategoryId
            ? lines.filter((l) => l.categoryId === rule.scopeCategoryId)
            : lines;
        const sticks = sum(scoped.map((l) => l.sticksSold));
        const amount = sticks.times(perUnit);
        incentiveTotal = incentiveTotal.plus(amount);
        payLines.push({
          kind: "INCENTIVE",
          ruleType: rule.type,
          label: "Per stick sold",
          computation: `${sticks.toFixed(1)} sticks × ${peso(perUnit)}`,
          amount: money(amount),
        });
        break;
      }

      case "TARGET_BONUS": {
        const target = num(rule.params, "targetNetSales");
        const bonus = num(rule.params, "bonusAmount");
        const hit = netSales.greaterThanOrEqualTo(target);
        if (hit) incentiveTotal = incentiveTotal.plus(bonus);
        payLines.push({
          kind: "INCENTIVE",
          ruleType: rule.type,
          label: "Daily target bonus",
          computation: hit
            ? `${peso(netSales)} reached the ${peso(target)} target`
            : `${peso(netSales)} fell short of the ${peso(target)} target`,
          amount: money(hit ? bonus : ZERO),
        });
        break;
      }

      case "ATTENDANCE": {
        const amount = num(rule.params, "amount");
        if (!worked || amount.isZero()) break;
        incentiveTotal = incentiveTotal.plus(amount);
        payLines.push({
          kind: "INCENTIVE",
          ruleType: rule.type,
          label: "Attendance",
          computation: "Showed up and closed the shift",
          amount: money(amount),
        });
        break;
      }
    }
  }

  // ---- deductions -------------------------------------------------------
  let deductionTotal = ZERO;
  let shortageSuppressed = false;

  if (scheme.deductShortage && cashVariance.isNegative()) {
    const shortage = cashVariance.abs();
    if (!shift.vendorAcknowledged) {
      // No acknowledgment, no deduction (spec §7). The shift still closes.
      shortageSuppressed = true;
      payLines.push({
        kind: "DEDUCTION",
        ruleType: "CASH_SHORTAGE",
        label: "Cash shortage — not deducted",
        computation: `${peso(shortage)} short, but the vendor has not acknowledged the count`,
        amount: "0.00",
      });
    } else {
      const cap = scheme.maxShortageDeduction === null ? null : dec(scheme.maxShortageDeduction);
      const applied = cap && shortage.greaterThan(cap) ? cap : shortage;
      deductionTotal = deductionTotal.plus(applied);
      payLines.push({
        kind: "DEDUCTION",
        ruleType: "CASH_SHORTAGE",
        label: "Cash shortage",
        computation: cap && shortage.greaterThan(cap)
          ? `${peso(shortage)} short, capped at ${peso(cap)}`
          : `${peso(shortage)} short, deducted in full`,
        amount: money(applied),
      });
    }
  }

  for (const extra of input.deductions ?? []) {
    const amount = dec(extra.amount);
    if (amount.isZero()) continue;
    deductionTotal = deductionTotal.plus(amount);
    payLines.push({
      kind: "DEDUCTION",
      ruleType: extra.type,
      label: extra.type.replace(/_/g, " ").toLowerCase(),
      computation: extra.note ?? "Approved deduction",
      amount: money(amount),
    });
  }

  const netPay = basePay.plus(incentiveTotal).minus(deductionTotal);

  return {
    basePay: money(basePay),
    incentiveTotal: money(incentiveTotal),
    deductionTotal: money(deductionTotal),
    netPay: money(netPay),
    lines: payLines,
    shortageSuppressed,
    blockedByDispute: shift.status === "DISPUTED",
  };
}

/** Roll a period's shifts into one payroll line per employee. */
export function aggregatePay(
  shifts: { basePay: string; incentiveTotal: string; deductionTotal: string; netPay: string }[],
): { daysWorked: number; basePayTotal: string; incentiveTotal: string; deductionTotal: string; netPay: string } {
  return {
    daysWorked: shifts.length,
    basePayTotal: money(sum(shifts.map((s) => s.basePay))),
    incentiveTotal: money(sum(shifts.map((s) => s.incentiveTotal))),
    deductionTotal: money(sum(shifts.map((s) => s.deductionTotal))),
    netPay: money(sum(shifts.map((s) => s.netPay))),
  };
}
