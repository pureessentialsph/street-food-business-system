/**
 * Who worked a cart on a given day. PURE — no database.
 *
 * The roster is not a label: every name on it earns a day's pay, and the first name is
 * the one answerable for the cash. So changing it is a money change, and the arithmetic
 * of "who joined, who left, who is still here" is worth doing in one tested place
 * rather than inline on a screen. Getting it wrong pays the wrong person — or, worse,
 * leaves a payslip behind for somebody who was never there.
 */

export type RosterMember = { employeeId: string; isPrimary: boolean };

export type RosterPlan =
  | { kind: "unchanged" }
  | {
      kind: "change";
      /** Answerable for the cash. */
      primaryId: string;
      /** Names to add to the shift. */
      add: string[];
      /** Names to take off it — their draft pay for the day goes with them. */
      remove: string[];
      /** True when the same people worked it but the cash now sits with someone else. */
      primaryChanged: boolean;
    }
  | { kind: "refused"; reason: string };

/**
 * `requested` is in order: the first is the primary. Order beyond the first carries no
 * meaning, so re-ordering the others is not a change.
 */
export function planRoster(current: readonly RosterMember[], requested: readonly string[]): RosterPlan {
  const names = requested.map((id) => id.trim()).filter((id) => id.length > 0);
  if (names.length === 0) {
    return { kind: "refused", reason: "A shift needs at least one vendor — somebody worked the cart." };
  }
  if (new Set(names).size !== names.length) {
    return { kind: "refused", reason: "The same person is listed twice." };
  }

  const primaryId = names[0]!;
  const currentIds = current.map((m) => m.employeeId);
  const currentPrimary = current.find((m) => m.isPrimary)?.employeeId ?? currentIds[0] ?? null;

  const add = names.filter((id) => !currentIds.includes(id));
  const remove = currentIds.filter((id) => !names.includes(id));
  const primaryChanged = currentPrimary !== primaryId;

  if (add.length === 0 && remove.length === 0 && !primaryChanged) return { kind: "unchanged" };
  return { kind: "change", primaryId, add, remove, primaryChanged };
}

/** One line for the audit trail and the message back to the screen. */
export function describeRoster(
  plan: Extract<RosterPlan, { kind: "change" }>,
  nameOf: (employeeId: string) => string,
): string {
  const parts: string[] = [];
  if (plan.add.length > 0) parts.push(`added ${plan.add.map(nameOf).join(" and ")}`);
  if (plan.remove.length > 0) parts.push(`removed ${plan.remove.map(nameOf).join(" and ")}`);
  if (plan.primaryChanged) parts.push(`${nameOf(plan.primaryId)} is answerable for the cash`);
  return parts.join("; ");
}
