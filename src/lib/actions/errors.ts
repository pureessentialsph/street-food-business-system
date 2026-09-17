import { ForbiddenError } from "@/lib/rbac";

/** What every server action returns. Never throw at the form; show the operator a message. */
export type ActionResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Turn any thrown error into something an operator can act on. */
export function toActionError(error: unknown): ActionResult {
  /**
   * redirect() and notFound() signal through a thrown error carrying a digest. Catching
   * those turns "your session ended, sign in again" into "Something went wrong. Nothing
   * was saved." — which is what an expired session looked like on the price list. Let
   * them through to Next.js.
   */
  const digest = (error as { digest?: unknown })?.digest;
  if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")) {
    throw error;
  }

  if (error instanceof ForbiddenError) return { ok: false, error: error.message };

  const message = error instanceof Error ? error.message : String(error);

  // Prisma unique-constraint violation: say which value collided, not "P2002".
  if (message.includes("Unique constraint failed")) {
    const field = /\(`?(\w+)`?\)/.exec(message)?.[1] ?? "value";
    return {
      ok: false,
      error: `That ${field.replace(/Id$/, "")} is already used. Codes must be unique within the company.`,
    };
  }
  if (message.includes("Foreign key constraint")) {
    return { ok: false, error: "That record is still referenced by something else and cannot be removed." };
  }
  if (message.startsWith("Cross-tenant")) {
    return { ok: false, error: "That record belongs to another company." };
  }
  console.error("[action]", error);
  return { ok: false, error: "Something went wrong. Nothing was saved." };
}
