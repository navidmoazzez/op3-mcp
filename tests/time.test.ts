import { describe, expect, it } from "vitest";
import { buildWindow, dayKey, monthKey, parseInstant, weekKey } from "../src/format/time.js";

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0);

describe("time parsing", () => {
  it("reads relative hours, days, weeks and months", () => {
    expect(parseInstant("-24h", NOW)).toBe(NOW - 86_400_000);
    expect(parseInstant("-7d", NOW)).toBe(NOW - 7 * 86_400_000);
    expect(parseInstant("-2w", NOW)).toBe(NOW - 14 * 86_400_000);
    expect(parseInstant("-3m", NOW)).toBe(NOW - 3 * 2_592_000_000);
  });

  it("treats a bare date as UTC midnight, not local", () => {
    expect(parseInstant("2026-08-01", NOW)).toBe(Date.UTC(2026, 7, 1));
    // Single-digit month and day, which Date.parse handles inconsistently.
    expect(parseInstant("2026-8-1", NOW)).toBe(Date.UTC(2026, 7, 1));
  });

  it("rejects a time it cannot read rather than silently defaulting", () => {
    expect(() => parseInstant("last tuesday", NOW)).toThrow(/not a time/i);
  });

  it("rejects an unknown unit", () => {
    expect(() => parseInstant("-5y", NOW)).toThrow();
  });
});

describe("windows", () => {
  it("defaults to 30 days, matching OP3's own rolled-up period", () => {
    const w = buildWindow(undefined, undefined, NOW);
    expect(w.days).toBeCloseTo(30, 5);
    expect(w.start).toBe("-30d");
  });

  it("refuses a window that ends before it starts", () => {
    expect(() => buildWindow("-1d", "-7d", NOW)).toThrow(/ends before it starts/i);
  });

  it("computes day count across an explicit range", () => {
    const w = buildWindow("2026-08-01", "2026-08-31", NOW);
    expect(w.days).toBe(30);
  });
});

describe("bucket keys", () => {
  it("buckets by UTC day", () => {
    expect(dayKey("2026-08-31T23:59:00.000Z")).toBe("2026-08-31");
  });

  it("buckets by ISO week, starting Monday", () => {
    // 2026-08-31 is a Monday, so it opens its own ISO week.
    expect(weekKey("2026-08-31T00:00:00.000Z")).toBe(weekKey("2026-09-06T23:00:00.000Z"));
    expect(weekKey("2026-08-30T00:00:00.000Z")).not.toBe(weekKey("2026-08-31T00:00:00.000Z"));
  });

  it("buckets by month", () => {
    expect(monthKey("2026-08-31T12:00:00.000Z")).toBe("2026-08");
  });
});
