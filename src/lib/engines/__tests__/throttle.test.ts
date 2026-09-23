import { describe, expect, it } from "vitest";
import {
  afterFailure, evaluate, PER_ACCOUNT, retryAfterMinutes, type ThrottleState,
} from "../throttle";

const t0 = new Date("2026-09-24T08:00:00.000Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

/** Walk a bucket through n failures, one a minute, from t0. */
function failTimes(n: number, from = 0): ThrottleState {
  let state: ThrottleState | null = null;
  for (let i = 0; i < n; i++) state = afterFailure(state, at(from + i), PER_ACCOUNT);
  return state!;
}

describe("login throttling", () => {
  it("lets an unknown bucket through", () => {
    expect(evaluate(null, t0)).toEqual({ allowed: true });
  });

  it("allows the first four wrong guesses — people mistype", () => {
    const state = failTimes(4);
    expect(state.failures).toBe(4);
    expect(state.lockedUntil).toBeNull();
    expect(evaluate(state, at(4))).toEqual({ allowed: true });
  });

  it("locks on the fifth", () => {
    const state = failTimes(5);
    expect(state.lockedUntil).not.toBeNull();
    const decision = evaluate(state, at(5));
    expect(decision.allowed).toBe(false);
  });

  it("stays locked for the full fifteen minutes after the fifth try", () => {
    // failures land at minutes 0..4, so the lock runs from minute 4 to minute 19
    const state = failTimes(5);
    expect(state.lockedUntil?.toISOString()).toBe(at(19).toISOString());
    expect(evaluate(state, at(18)).allowed).toBe(false);
    expect(evaluate(state, at(19)).allowed).toBe(true);
  });

  it("counts a lapsed window from scratch, so this morning's typo is not tonight's lockout", () => {
    let state = failTimes(4);
    // one more, but sixteen minutes after the window opened
    state = afterFailure(state, at(16), PER_ACCOUNT);
    expect(state.failures).toBe(1);
    expect(state.lockedUntil).toBeNull();
  });

  it("does not re-lock instantly on the first failure after a lock expires", () => {
    const locked = failTimes(5);
    const afterExpiry = afterFailure(locked, at(21), PER_ACCOUNT);
    expect(afterExpiry.failures).toBe(1);
    expect(afterExpiry.lockedUntil).toBeNull();
    expect(evaluate(afterExpiry, at(21)).allowed).toBe(true);
  });

  it("reports whole minutes to wait, rounded up and never zero", () => {
    const state = failTimes(5);
    const decision = evaluate(state, at(5)); // locked until minute 19
    if (decision.allowed) throw new Error("expected a lock");
    expect(retryAfterMinutes(decision.retryAfterMs)).toBe(14);
    // a few seconds left still reads as "a minute", never "0 minutes"
    expect(retryAfterMinutes(1)).toBe(1);
  });

  it("keeps counting inside the window even as failures pile up past the limit", () => {
    const state = failTimes(7);
    expect(state.failures).toBe(7);
    expect(evaluate(state, at(7)).allowed).toBe(false);
  });

  it("treats a bucket whose lock has passed as allowed, without needing a write", () => {
    const state: ThrottleState = {
      failures: 5,
      windowStartedAt: t0,
      lockedUntil: at(10),
    };
    expect(evaluate(state, at(11))).toEqual({ allowed: true });
  });
});
