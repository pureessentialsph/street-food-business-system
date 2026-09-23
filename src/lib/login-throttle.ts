import { createHash } from "node:crypto";
import { rawDb } from "@/lib/db";
import {
  afterFailure, evaluate, PER_ACCOUNT, PER_ADDRESS, retryAfterMinutes,
  type ThrottlePolicy,
} from "@/lib/engines/throttle";

/**
 * Storage for the throttle policy. Kept in the database rather than in memory because
 * the app runs as serverless functions: an in-memory counter is per instance, so five
 * attempts becomes five per instance, and a cold start forgets everything.
 */

/**
 * Keys are hashed. The table exists to count failures, not to accumulate a list of
 * which addresses tried which email — hashing means a leak of this table tells an
 * attacker nothing they did not already supply.
 */
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Behind Vercel the client address is the first entry of x-forwarded-for. */
export function addressFrom(request: Request | undefined): string {
  const forwarded = request?.headers.get("x-forwarded-for") ?? "";
  const first = forwarded.split(",")[0]?.trim();
  return first || request?.headers.get("x-real-ip")?.trim() || "unknown";
}

function keysFor(email: string, address: string): { key: string; policy: ThrottlePolicy }[] {
  return [
    { key: `account:${hash(`${email.toLowerCase()}|${address}`)}`, policy: PER_ACCOUNT },
    { key: `address:${hash(address)}`, policy: PER_ADDRESS },
  ];
}

export type LockedOut = { lockedOut: true; retryAfterMinutes: number };
export type Allowed = { lockedOut: false };

/** Checked BEFORE the password is verified — hashing a password is the expensive part. */
export async function checkLoginAllowed(
  email: string,
  address: string,
  now = new Date(),
): Promise<LockedOut | Allowed> {
  const rows = await rawDb.loginThrottle.findMany({
    where: { key: { in: keysFor(email, address).map((k) => k.key) } },
  });

  let worst = 0;
  for (const row of rows) {
    const decision = evaluate(row, now);
    if (!decision.allowed) worst = Math.max(worst, decision.retryAfterMs);
  }
  return worst > 0
    ? { lockedOut: true, retryAfterMinutes: retryAfterMinutes(worst) }
    : { lockedOut: false };
}

export async function recordLoginFailure(
  email: string,
  address: string,
  now = new Date(),
): Promise<void> {
  for (const { key, policy } of keysFor(email, address)) {
    const existing = await rawDb.loginThrottle.findUnique({ where: { key } });
    const next = afterFailure(existing, now, policy);
    await rawDb.loginThrottle.upsert({
      where: { key },
      update: next,
      create: { key, ...next },
    });
  }
  await pruneStaleBuckets(now);
}

/**
 * A correct password clears THIS account's bucket — one good sign-in undoes the day's
 * typos. The address bucket is deliberately left to age out: clearing it on any success
 * would let someone spray two dozen accounts, sign into their own, and start again.
 */
export async function clearLoginFailures(email: string, address: string): Promise<void> {
  const accountKey = keysFor(email, address)[0]!.key;
  await rawDb.loginThrottle.deleteMany({ where: { key: accountKey } });
}

/**
 * Buckets are worthless once their window and lock have both passed, and nothing else
 * ever deletes them. Pruned opportunistically rather than on a schedule: a sweep on
 * roughly one failure in twenty costs nothing and needs no cron to be configured.
 */
async function pruneStaleBuckets(now: Date): Promise<void> {
  if (Math.random() > 0.05) return;
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000);
  try {
    await rawDb.loginThrottle.deleteMany({ where: { updatedAt: { lt: cutoff } } });
  } catch (error) {
    // Housekeeping must never be the reason a sign-in attempt errors.
    console.error("[pruneStaleBuckets]", error);
  }
}

/**
 * How long this caller must wait. Safe to expose unauthenticated: the account bucket is
 * keyed on the caller's own address, so it can only report a lock the caller created.
 */
export async function lockoutFor(
  email: string,
  address: string,
  now = new Date(),
): Promise<number | null> {
  const state = await checkLoginAllowed(email, address, now);
  return state.lockedOut ? state.retryAfterMinutes : null;
}
