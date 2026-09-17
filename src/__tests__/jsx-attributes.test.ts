import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * TypeScript cannot catch this one: `href="/carts?edit={c.id}"` is a perfectly valid
 * string, so it compiles, renders, and quietly links to a literal "{c.id}". It shipped
 * once and made the Edit button on Carts and Employees do nothing at all. Real
 * interpolation needs braces around the whole value: href={`/carts?edit=${c.id}`}.
 */
describe("JSX attributes", () => {
  const files = execFileSync("git", ["ls-files", "src/**/*.tsx"], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("never puts an un-evaluated {expression} inside a quoted attribute", () => {
    // A brace pair containing a dot or an opening paren is code, not copy: "{c.id}",
    // "{formatPHP(x)}". Prose braces and CSS-in-string cases stay allowed.
    const suspect = /=\s*"[^"\n]*\{[A-Za-z_$][\w$]*\s*[.(][^"\n]*\}[^"\n]*"/;
    const offenders: string[] = [];

    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (suspect.test(line)) offenders.push(`${file}:${i + 1} ${line.trim()}`);
        });
    }

    expect(offenders).toEqual([]);
  });
});
