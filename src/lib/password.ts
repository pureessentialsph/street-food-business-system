/**
 * What makes an acceptable password. PURE — no database, no hashing — so the rules can
 * be tested directly and stated to the operator in the same words the check uses.
 *
 * Length is the rule that actually matters; composition rules mostly teach people to
 * write Password1! and call it done. The minimum matches scripts/create-owner.ts, so a
 * password set on the command line and one set in the app are held to the same bar.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export type PasswordProblem =
  | "too-short"
  | "too-long"
  | "mismatch"
  | "unchanged"
  | "all-one-character";

export const PASSWORD_MESSAGES: Record<PasswordProblem, string> = {
  "too-short": `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember beats a short password you cannot.`,
  "too-long": `That is longer than ${MAX_PASSWORD_LENGTH} characters.`,
  mismatch: "The two new passwords do not match.",
  unchanged: "That is the password you already have.",
  "all-one-character": "That is the same character repeated — it is no longer than one.",
};

export function checkNewPassword({
  next, confirm, current,
}: {
  next: string;
  confirm: string;
  /** The password being replaced, so an unchanged one can be rejected. */
  current?: string;
}): PasswordProblem | null {
  if (next.length < MIN_PASSWORD_LENGTH) return "too-short";
  if (next.length > MAX_PASSWORD_LENGTH) return "too-long";
  if (new Set(next).size === 1) return "all-one-character";
  if (next !== confirm) return "mismatch";
  if (current !== undefined && next === current) return "unchanged";
  return null;
}
