import { describe, expect, it } from "vitest";
import { payWeekFor, previousPayWeek } from "../pay-week";

const on = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("the pay week — Sunday to Saturday, settled on the Saturday", () => {
  it("pays the week just worked when asked on a Saturday", () => {
    // 3 Oct 2026 is a Saturday
    expect(payWeekFor(on("2026-10-03"))).toEqual({ start: "2026-09-27", end: "2026-10-03" });
  });

  it("includes the Saturday itself, since pay comes after the shift ends", () => {
    const week = payWeekFor(on("2026-10-03"));
    expect(week.end).toBe("2026-10-03");
  });

  it("looks back to the last finished week on any other day", () => {
    // Sunday 4 Oct through Friday 9 Oct all settle the week ended 3 Oct
    for (const day of ["2026-10-04", "2026-10-05", "2026-10-07", "2026-10-09"]) {
      expect(payWeekFor(on(day)).end).toBe("2026-10-03");
    }
  });

  it("rolls to the next Saturday once it arrives", () => {
    expect(payWeekFor(on("2026-10-10"))).toEqual({ start: "2026-10-04", end: "2026-10-10" });
  });

  it("always spans exactly seven days", () => {
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2026, 8, 1) + i * 86400000);
      const { start, end } = payWeekFor(day);
      const span = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
      expect(span).toBe(6);
    }
  });

  it("starts on a Sunday and ends on a Saturday, whatever day it is asked", () => {
    for (let i = 0; i < 40; i++) {
      const day = new Date(Date.UTC(2026, 8, 1) + i * 86400000);
      const { start, end } = payWeekFor(day);
      expect(new Date(`${start}T00:00:00Z`).getUTCDay()).toBe(0);
      expect(new Date(`${end}T00:00:00Z`).getUTCDay()).toBe(6);
    }
  });

  it("never leaves a gap or an overlap between consecutive weeks", () => {
    const week = payWeekFor(on("2026-10-10"));
    const before = previousPayWeek(on("2026-10-10"));
    expect(before.end).toBe("2026-10-03");
    const gap = (Date.parse(`${week.start}T00:00:00Z`) - Date.parse(`${before.end}T00:00:00Z`)) / 86400000;
    expect(gap).toBe(1);
  });

  it("covers the two days recorded for 29 and 30 September", () => {
    // both fall in the week ended Saturday 3 October
    const week = payWeekFor(on("2026-10-03"));
    expect(week.start <= "2026-09-29").toBe(true);
    expect(week.end >= "2026-09-30").toBe(true);
  });
});
