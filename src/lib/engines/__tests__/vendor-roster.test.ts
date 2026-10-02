import { describe, expect, it } from "vitest";
import { describeRoster, planRoster, type RosterPlan } from "../vendor-roster";

const change = (plan: RosterPlan) => {
  if (plan.kind !== "change") throw new Error(`expected a change, got ${plan.kind}`);
  return plan;
};

describe("planRoster", () => {
  it("refuses an empty roster — somebody worked the cart", () => {
    expect(planRoster([{ employeeId: "a", isPrimary: true }], [])).toEqual({
      kind: "refused",
      reason: expect.stringContaining("at least one vendor"),
    });
  });

  it("refuses blank ids, which is an empty roster wearing a disguise", () => {
    expect(planRoster([], ["", "  "]).kind).toBe("refused");
  });

  it("refuses the same person twice, which would pay them twice", () => {
    expect(planRoster([], ["a", "a"])).toEqual({
      kind: "refused",
      reason: expect.stringContaining("twice"),
    });
  });

  it("reports no change when the same people are listed with the same primary", () => {
    const current = [
      { employeeId: "a", isPrimary: true },
      { employeeId: "b", isPrimary: false },
    ];
    expect(planRoster(current, ["a", "b"])).toEqual({ kind: "unchanged" });
  });

  it("ignores the order of everyone after the primary", () => {
    const current = [
      { employeeId: "a", isPrimary: true },
      { employeeId: "b", isPrimary: false },
      { employeeId: "c", isPrimary: false },
    ];
    expect(planRoster(current, ["a", "c", "b"])).toEqual({ kind: "unchanged" });
  });

  it("swaps one vendor for two", () => {
    const plan = change(planRoster([{ employeeId: "adriel", isPrimary: true }], ["ruth", "gilda"]));
    expect(plan.primaryId).toBe("ruth");
    expect(plan.add).toEqual(["ruth", "gilda"]);
    expect(plan.remove).toEqual(["adriel"]);
    expect(plan.primaryChanged).toBe(true);
  });

  it("treats handing the cash to the other vendor as a change, though nobody joined or left", () => {
    const current = [
      { employeeId: "a", isPrimary: true },
      { employeeId: "b", isPrimary: false },
    ];
    const plan = change(planRoster(current, ["b", "a"]));
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.primaryChanged).toBe(true);
    expect(plan.primaryId).toBe("b");
  });

  it("drops the second vendor without disturbing the first", () => {
    const current = [
      { employeeId: "a", isPrimary: true },
      { employeeId: "b", isPrimary: false },
    ];
    const plan = change(planRoster(current, ["a"]));
    expect(plan.remove).toEqual(["b"]);
    expect(plan.add).toEqual([]);
    expect(plan.primaryChanged).toBe(false);
  });

  it("takes the first of an unflagged roster as the primary, so old shifts read sensibly", () => {
    const current = [
      { employeeId: "a", isPrimary: false },
      { employeeId: "b", isPrimary: false },
    ];
    expect(planRoster(current, ["a", "b"])).toEqual({ kind: "unchanged" });
    expect(change(planRoster(current, ["b", "a"])).primaryChanged).toBe(true);
  });

  it("trims whitespace rather than treating it as a different person", () => {
    expect(planRoster([{ employeeId: "a", isPrimary: true }], [" a "])).toEqual({ kind: "unchanged" });
  });
});

describe("describeRoster", () => {
  const nameOf = (id: string) => ({ ruth: "Ruth Ann", gilda: "Gilda", adriel: "Adriel" })[id] ?? id;

  it("says what happened, in the order it reads best", () => {
    const plan = change(planRoster([{ employeeId: "adriel", isPrimary: true }], ["ruth", "gilda"]));
    expect(describeRoster(plan, nameOf)).toBe(
      "added Ruth Ann and Gilda; removed Adriel; Ruth Ann is answerable for the cash",
    );
  });

  it("mentions only the cash when that is all that moved", () => {
    const current = [
      { employeeId: "ruth", isPrimary: true },
      { employeeId: "gilda", isPrimary: false },
    ];
    expect(describeRoster(change(planRoster(current, ["gilda", "ruth"])), nameOf)).toBe(
      "Gilda is answerable for the cash",
    );
  });
});
