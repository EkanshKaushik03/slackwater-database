import { afterEach, describe, expect, test, vi } from "vitest";
import {
  loadAllStations,
  RECENCY_YEAR,
  scoreRecency,
} from "../evaluate-quality.ts";

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

// CI's filesystem lists files in hash order, a Mac's in name order; quality
// must not depend on which.
test("weighs records in id order whatever the filesystem lists", async () => {
  const ids = (await loadAllStations()).map(({ id }) => id);
  expect(ids).toEqual([...ids].sort());
});
