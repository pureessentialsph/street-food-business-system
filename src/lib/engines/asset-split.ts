/**
 * Moving part of a bundle. PURE — no database.
 *
 * A row of assets means "these N, here". Sending some of them elsewhere therefore
 * splits the row: fewer left behind, a new row at the destination. The only thing that
 * must never happen is the total changing, so the arithmetic lives here on its own and
 * is checked rather than trusted.
 */

export type SplitPlan =
  | { kind: "move-all" }
  | { kind: "split"; remaining: number; moving: number }
  | { kind: "refused"; reason: string };

export function planSplit(available: number, requested: number): SplitPlan {
  if (!Number.isInteger(requested) || requested <= 0) {
    return { kind: "refused", reason: "Move at least one." };
  }
  if (requested > available) {
    return {
      kind: "refused",
      reason: `There ${available === 1 ? "is" : "are"} only ${available} here.`,
    };
  }
  if (requested === available) return { kind: "move-all" };
  return { kind: "split", remaining: available - requested, moving: requested };
}

/**
 * A tag for the half that moves. Tags are unique per company, so the split cannot reuse
 * the original; it extends it, which keeps the two visibly related in any list.
 */
export function splitTag(tag: string, taken: ReadonlySet<string>): string {
  for (let suffix = 2; suffix < 1000; suffix++) {
    const candidate = `${tag}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${tag}-${Date.now().toString().slice(-6)}`;
}
