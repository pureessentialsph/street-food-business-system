/**
 * Login throttling policy. PURE — no database, no clock of its own — so the rules can
 * be tested directly instead of by waiting fifteen minutes.
 *
 * Counting is per bucket. A bucket is a window with a failure count: once the window
 * has elapsed the count starts again, and once the count is reached the bucket is
 * locked until a deadline. Success empties the bucket.
 */

export type ThrottleState = {
  failures: number;
  /** When the current counting window began. */
  windowStartedAt: Date;
  /** Locked until this moment; null when not locked. */
  lockedUntil: Date | null;
};

export type ThrottlePolicy = {
  /** Failures allowed inside one window before the bucket locks. */
  limit: number;
  windowMs: number;
  lockMs: number;
};

/**
 * Per email-and-address. Deliberately keyed on both: locking an email outright would
 * let anyone who knows the owner's address lock them out of their own business, which
 * turns a brute-force defence into a denial of service.
 */
export const PER_ACCOUNT: ThrottlePolicy = {
  limit: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

/** Per address alone, so one machine cannot spray many accounts at five tries each. */
export const PER_ADDRESS: ThrottlePolicy = {
  limit: 25,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
};

export type Decision =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export function evaluate(state: ThrottleState | null, now: Date): Decision {
  if (!state?.lockedUntil) return { allowed: true };
  const remaining = state.lockedUntil.getTime() - now.getTime();
  return remaining > 0 ? { allowed: false, retryAfterMs: remaining } : { allowed: true };
}

/**
 * The bucket after one more failure. A lock that has expired starts a fresh window
 * rather than resuming the old count — otherwise one attempt after a lapsed lock would
 * lock the account again immediately, and an honest person who mistyped twice this
 * morning would be shut out tonight.
 */
export function afterFailure(
  state: ThrottleState | null,
  now: Date,
  policy: ThrottlePolicy,
): ThrottleState {
  const expired =
    !state ||
    (state.lockedUntil !== null && state.lockedUntil.getTime() <= now.getTime()) ||
    now.getTime() - state.windowStartedAt.getTime() >= policy.windowMs;

  const failures = expired ? 1 : state.failures + 1;
  const windowStartedAt = expired ? now : state.windowStartedAt;

  return {
    failures,
    windowStartedAt,
    lockedUntil:
      failures >= policy.limit ? new Date(now.getTime() + policy.lockMs) : null,
  };
}

/** Whole minutes, rounded up, for a message a person reads. */
export function retryAfterMinutes(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 60_000));
}
