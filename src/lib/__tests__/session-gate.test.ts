import { describe, expect, it } from "vitest";
import { authConfig } from "../auth.config";
import { toActionError } from "../actions/errors";

/**
 * The day a session token decoded cleanly but carried none of our fields, the gate
 * waved it through and every page died with "a server-side exception has occurred",
 * while every form said "Something went wrong. Nothing was saved." Both halves of that
 * are guarded here: the gate must agree with requireUser() on what signed in means,
 * and a redirect must never be swallowed as a generic failure.
 */

const gate = authConfig.callbacks!.authorized!;
const ask = (user: unknown, pathname = "/dashboard") =>
  gate({
    auth: (user === undefined ? null : { user }) as never,
    request: { nextUrl: { pathname } } as never,
  });

describe("the login gate", () => {
  it("lets a fully formed session through", () => {
    expect(ask({ id: "u1", companyId: "c1" })).toBe(true);
  });

  it("turns away a token that decodes but carries no identity", () => {
    expect(ask({})).toBe(false);
    expect(ask({ id: "", companyId: "" })).toBe(false);
  });

  it("turns away a session with a user but no company — it cannot be scoped", () => {
    expect(ask({ id: "u1" })).toBe(false);
    expect(ask({ id: "u1", companyId: "" })).toBe(false);
  });

  it("turns away no session at all", () => {
    expect(ask(undefined)).toBe(false);
  });

  it("always allows the login page itself, or nobody could ever sign back in", () => {
    expect(ask(undefined, "/login")).toBe(true);
  });
});

describe("toActionError", () => {
  it("re-throws a redirect instead of reporting it as a failed save", () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    expect(() => toActionError(redirectError)).toThrow(redirectError);
  });

  it("re-throws notFound the same way", () => {
    const notFound = Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
    expect(() => toActionError(notFound)).toThrow(notFound);
  });

  it("still reports an ordinary failure to the operator", () => {
    const result = toActionError(new Error("column does not exist"));
    expect(result).toEqual({ ok: false, error: "Something went wrong. Nothing was saved." });
  });

  it("still names the colliding field on a unique-constraint violation", () => {
    const result = toActionError(new Error("Unique constraint failed on the fields: (`code`)"));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("already used");
  });
});
