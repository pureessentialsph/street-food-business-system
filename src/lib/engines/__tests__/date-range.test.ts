import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRESET, MAX_DAILY_BARS, MAX_DAYS, eachDate, granularityFor,
  presetRange, resolveRange, weekBuckets,
} from "../date-range";

/** A Friday, so weekday arithmetic is actually exercised. */
const TODAY = "2026-10-02";

describe("presetRange", () => {
  it("counts today as one of the last 7 days, not as an eighth", () => {
    expect(presetRange("7d", TODAY)).toEqual({ from: "2026-09-26", to: TODAY });
  });

  it("gives a single day for today and yesterday", () => {
    expect(presetRange("today", TODAY)).toEqual({ from: TODAY, to: TODAY });
    expect(presetRange("yesterday", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-01" });
  });

  it("runs this month from the first to its last day, not to today", () => {
    expect(presetRange("month", TODAY)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("gets last month's length right", () => {
    expect(presetRange("lastMonth", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("lastMonth", "2026-03-15")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("handles the turn of the year", () => {
    expect(presetRange("lastMonth", "2027-01-10")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(presetRange("7d", "2027-01-03")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });
});

describe("resolveRange", () => {
  it("defaults to the last 14 days when nothing is asked for", () => {
    const resolved = resolveRange({}, TODAY);
    expect(resolved.range).toEqual(presetRange(DEFAULT_PRESET, TODAY));
    expect(resolved.preset).toBe(DEFAULT_PRESET);
    expect(resolved.days).toBe(14);
  });

  it("ignores a preset it does not know rather than throwing at the page", () => {
    expect(resolveRange({ preset: "forever" }, TODAY).preset).toBe(DEFAULT_PRESET);
  });

  it("reads a range entered backwards as the one they meant", () => {
    const resolved = resolveRange({ from: "2026-10-01", to: "2026-09-29" }, TODAY);
    expect(resolved.range).toEqual({ from: "2026-09-29", to: "2026-10-01" });
    expect(resolved.days).toBe(3);
  });

  it("treats one end on its own as that single day", () => {
    expect(resolveRange({ from: "2026-09-30" }, TODAY).range).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(resolveRange({ to: "2026-09-30" }, TODAY).range).toEqual({ from: "2026-09-30", to: "2026-09-30" });
  });

  it("clamps the future to today, and says so", () => {
    const resolved = resolveRange({ from: "2026-10-01", to: "2026-12-31" }, TODAY);
    expect(resolved.range).toEqual({ from: "2026-10-01", to: TODAY });
    expect(resolved.note).toMatch(/has not happened/);
  });

  it("collapses a range entirely in the future onto today rather than inverting it", () => {
    const resolved = resolveRange({ from: "2026-11-01", to: "2026-11-30" }, TODAY);
    expect(resolved.range).toEqual({ from: TODAY, to: TODAY });
  });

  it("caps an enormous range and says what it did", () => {
    const resolved = resolveRange({ from: "2020-01-01", to: TODAY }, TODAY);
    expect(resolved.days).toBe(MAX_DAYS);
    expect(resolved.range.to).toBe(TODAY);
    expect(resolved.note).toMatch(new RegExp(`${MAX_DAYS} days`));
  });

  it("falls back to the default on a typo instead of showing nothing", () => {
    expect(resolveRange({ from: "02/10/2026", to: "" }, TODAY).preset).toBe(DEFAULT_PRESET);
    expect(resolveRange({ from: "2026-13-45" }, TODAY).preset).toBe(DEFAULT_PRESET);
  });

  it("recognises a typed range that happens to match a preset, so the chip lights up", () => {
    expect(resolveRange({ from: "2026-09-26", to: TODAY }, TODAY).preset).toBe("7d");
    expect(resolveRange({ from: "2026-09-25", to: TODAY }, TODAY).preset).toBe("custom");
  });

  it("says nothing when it changed nothing", () => {
    expect(resolveRange({ preset: "7d" }, TODAY).note).toBeUndefined();
  });

  it("counts both ends of a single day as one day", () => {
    expect(resolveRange({ preset: "today" }, TODAY).days).toBe(1);
  });

  it("clamps a preset that runs past today — this month, mid-month", () => {
    const resolved = resolveRange({ preset: "month" }, TODAY);
    expect(resolved.range).toEqual({ from: "2026-10-01", to: TODAY });
  });
});

describe("eachDate", () => {
  it("includes both ends and nothing between them is skipped", () => {
    expect(eachDate({ from: "2026-09-29", to: "2026-10-02" })).toEqual([
      "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02",
    ]);
  });

  it("returns the one day for a single-day range", () => {
    expect(eachDate({ from: TODAY, to: TODAY })).toEqual([TODAY]);
  });
});

describe("granularityFor", () => {
  it("charts a fortnight by day and a quarter by week", () => {
    expect(granularityFor(14)).toBe("day");
    expect(granularityFor(MAX_DAILY_BARS)).toBe("day");
    expect(granularityFor(MAX_DAILY_BARS + 1)).toBe("week");
    expect(granularityFor(90)).toBe("week");
  });
});

describe("weekBuckets", () => {
  it("starts each bucket on the Sunday, matching the pay week", () => {
    const buckets = weekBuckets(eachDate({ from: "2026-09-29", to: "2026-10-06" }));
    expect(buckets.map((b) => b.start)).toEqual(["2026-09-27", "2026-10-04"]);
  });

  it("keeps a part-week as a part-week rather than padding it", () => {
    const buckets = weekBuckets(["2026-10-02", "2026-10-03"]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.dates).toEqual(["2026-10-02", "2026-10-03"]);
  });

  it("loses no days", () => {
    const dates = eachDate({ from: "2026-01-01", to: "2026-03-31" });
    expect(weekBuckets(dates).flatMap((b) => b.dates)).toEqual(dates);
  });
});
