import { describe, expect, it } from "vitest";
import {
  businessDateFor,
  businessDayRange,
  fromDateColumn,
  toDateColumn,
  trailingBusinessDates,
} from "../businessDate";

describe("business date", () => {
  it("keeps a cart that closes after midnight on the previous business day", () => {
    // 01:30 Manila on 14 Sep = 17:30 UTC on 13 Sep.
    const afterMidnight = new Date("2026-09-13T17:30:00Z");
    expect(businessDateFor(afterMidnight, 4, "Asia/Manila")).toBe("2026-09-13");
  });

  it("rolls over once the 04:00 cutoff has passed", () => {
    // 04:30 Manila on 14 Sep = 20:30 UTC on 13 Sep.
    const afterCutoff = new Date("2026-09-13T20:30:00Z");
    expect(businessDateFor(afterCutoff, 4, "Asia/Manila")).toBe("2026-09-14");
  });

  it("treats a normal selling evening as its own date", () => {
    const evening = new Date("2026-09-13T11:00:00Z"); // 19:00 Manila
    expect(businessDateFor(evening, 4, "Asia/Manila")).toBe("2026-09-13");
  });

  it("round-trips through a DATE column without timezone drift", () => {
    expect(fromDateColumn(toDateColumn("2026-09-13"))).toBe("2026-09-13");
    expect(toDateColumn("2026-09-13").toISOString()).toBe("2026-09-13T00:00:00.000Z");
  });

  it("covers a 24-hour window per business day", () => {
    const { start, end } = businessDayRange("2026-09-13", 4, "Asia/Manila");
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(start.toISOString()).toBe("2026-09-12T20:00:00.000Z"); // 04:00 Manila
  });

  it("builds the trailing 14-day replenishment window", () => {
    const window = trailingBusinessDates("2026-09-13", 14);
    expect(window).toHaveLength(14);
    expect(window[0]).toBe("2026-08-31");
    expect(window.at(-1)).toBe("2026-09-13");
  });

  it("rejects a nonsense cutoff hour", () => {
    expect(() => businessDateFor(new Date(), 25)).toThrow();
  });
});
