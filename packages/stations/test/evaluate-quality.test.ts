import { afterEach, describe, expect, test, vi } from "vitest";
import { RECENCY_YEAR, scoreRecency } from "../evaluate-quality.ts";

describe("scoreRecency", () => {
  afterEach(() => vi.useRealTimers());

  test("does not depend on today's date", () => {
    const station = { epoch: { start: "1983-01-01", end: "2001-12-31" } };
    const score = () => scoreRecency(station as never, new Map());
    vi.useFakeTimers({ now: new Date("2026-06-01") });
    const now = score();
    vi.setSystemTime(new Date("2040-06-01"));
    expect(score()).toBe(now);
    expect(now).toBe(1 - (RECENCY_YEAR - 2001) / 100);
  });
});
