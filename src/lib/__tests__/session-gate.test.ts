import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authConfig, isSignedIn } from "../auth.config";
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

/**
 * The redirect loop. The login page decides whether an arriving browser is already
 * signed in and should go to the dashboard; the gate decides whether a browser asking
 * for the dashboard is signed in and may stay. Answer differently and the two hand the
 * request back and forth until the browser gives up with ERR_TOO_MANY_REDIRECTS —
 * which is exactly what a token that decoded but carried no fields did.
 */
describe("everything that asks whether someone is signed in", () => {
  const cases: { what: string; user: unknown }[] = [
    { what: "a full session", user: { id: "u1", companyId: "c1" } },
    { what: "a token with no fields", user: {} },
    { what: "empty strings", user: { id: "", companyId: "" } },
    { what: "a user with no company", user: { id: "u1" } },
    { what: "a company with no user", user: { companyId: "c1" } },
    { what: "no session at all", user: null },
  ];

  for (const { what, user } of cases) {
    it(`agrees about ${what}`, () => {
      const loginPageWouldBounceToDashboard = isSignedIn(user as never);
      const gateWouldAllowTheDashboard = gate({
        auth: (user === null ? null : { user }) as never,
        request: { nextUrl: { pathname: "/dashboard" } } as never,
      });
      // If the login page sends them on but the gate turns them back, they loop forever.
      expect(loginPageWouldBounceToDashboard).toBe(gateWouldAllowTheDashboard);
    });
  }
});

/**
 * The agreement above only holds while all three places actually call isSignedIn. The
 * loop happened because the login page kept its own looser test — `if (session?.user)`
 * — long after the gate had been tightened, and nothing in the suite noticed. Reading
 * the sources is blunt, but it is the thing that was wrong.
 */
describe("the three places that decide whether someone is signed in", () => {
  const callers = [
    "src/lib/auth.config.ts", // the middleware gate
    "src/lib/auth.ts",        // requireUser, on every page and action
    "src/app/(auth)/login/page.tsx", // the bounce to the dashboard
  ];

  for (const file of callers) {
    it(`${file} asks isSignedIn rather than rolling its own test`, () => {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("isSignedIn");
      // the loose test that caused the loop: a user object existing proves nothing
      expect(source).not.toMatch(/if\s*\(\s*session\??\.user\s*\)/);
    });
  }
});
