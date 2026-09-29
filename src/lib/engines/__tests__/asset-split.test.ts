import { describe, expect, it } from "vitest";
import { planSplit, splitTag } from "../asset-split";

describe("moving part of a bundle", () => {
  it("moves the whole row when every one is going", () => {
    expect(planSplit(10, 10)).toEqual({ kind: "move-all" });
  });

  it("splits when only some are going, and the two halves add back up", () => {
    const plan = planSplit(10, 3);
    if (plan.kind !== "split") throw new Error("expected a split");
    expect(plan.moving).toBe(3);
    expect(plan.remaining).toBe(7);
    expect(plan.remaining + plan.moving).toBe(10);
  });

  it("refuses more than are there, and says how many there are", () => {
    expect(planSplit(4, 5)).toEqual({ kind: "refused", reason: "There are only 4 here." });
    expect(planSplit(1, 2)).toEqual({ kind: "refused", reason: "There is only 1 here." });
  });

  it("refuses nothing, negatives and fractions of a tong", () => {
    expect(planSplit(10, 0).kind).toBe("refused");
    expect(planSplit(10, -3).kind).toBe("refused");
    expect(planSplit(10, 2.5).kind).toBe("refused");
  });

  it("handles a single item, which is the common case", () => {
    expect(planSplit(1, 1)).toEqual({ kind: "move-all" });
  });

  it("never loses or invents a unit, whatever is asked for", () => {
    for (let available = 1; available <= 12; available++) {
      for (let requested = 1; requested <= available; requested++) {
        const plan = planSplit(available, requested);
        const total = plan.kind === "split" ? plan.remaining + plan.moving : available;
        expect(total).toBe(available);
      }
    }
  });
});

describe("tagging the half that moves", () => {
  it("extends the original so the two stay visibly related", () => {
    expect(splitTag("AST-0051", new Set())).toBe("AST-0051-2");
  });

  it("steps past tags already in use", () => {
    expect(splitTag("AST-0051", new Set(["AST-0051-2", "AST-0051-3"]))).toBe("AST-0051-4");
  });

  it("never returns a tag that is taken", () => {
    const taken = new Set(Array.from({ length: 50 }, (_, i) => `AST-1-${i + 2}`));
    expect(taken.has(splitTag("AST-1", taken))).toBe(false);
  });
});
