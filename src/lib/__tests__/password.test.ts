import { describe, expect, it } from "vitest";
import { checkNewPassword, MIN_PASSWORD_LENGTH } from "../password";

const ok = "correct horse battery staple";

describe("what makes an acceptable password", () => {
  it("accepts a long passphrase", () => {
    expect(checkNewPassword({ next: ok, confirm: ok, current: "something else" })).toBeNull();
  });

  it("rejects anything under the minimum", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1) + "b";
    expect(checkNewPassword({ next: short.slice(0, 11), confirm: short.slice(0, 11) })).toBe("too-short");
  });

  it("accepts exactly the minimum", () => {
    const exact = "abcdefghijkl";
    expect(exact).toHaveLength(MIN_PASSWORD_LENGTH);
    expect(checkNewPassword({ next: exact, confirm: exact })).toBeNull();
  });

  it("rejects a long run of one character, which is not really long at all", () => {
    const repeated = "a".repeat(40);
    expect(checkNewPassword({ next: repeated, confirm: repeated })).toBe("all-one-character");
  });

  it("rejects a typo in the confirmation", () => {
    expect(checkNewPassword({ next: ok, confirm: `${ok} ` })).toBe("mismatch");
  });

  it("rejects re-setting the password you already have", () => {
    expect(checkNewPassword({ next: ok, confirm: ok, current: ok })).toBe("unchanged");
  });

  it("does not ask about the old password when there is none to compare", () => {
    expect(checkNewPassword({ next: ok, confirm: ok })).toBeNull();
  });

  it("checks length before matching, so a short typo reports the useful problem", () => {
    expect(checkNewPassword({ next: "short", confirm: "different" })).toBe("too-short");
  });

  it("keeps spaces — a passphrase is mostly spaces", () => {
    const spaced = "  leading and trailing  ";
    expect(checkNewPassword({ next: spaced, confirm: spaced })).toBeNull();
  });
});
