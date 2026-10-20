import { describe, test, expect } from "vitest";
import {
  computeDatums,
  computeDatumsFromObservations,
  parseGeslaSamples,
  type Sample,
} from "../datum.js";

describe("computeDatums", () => {
  test("retains both unequal highs and lows in each predicted tidal day", () => {
    const { datums } = computeDatums(
      [
        { name: "M2", amplitude: 1, phase: 0 },
        { name: "K1", amplitude: 0.5, phase: 0 },
      ],
      {},
    );
    expect(datums["MHHW"]! - datums["MHW"]!).toBeGreaterThan(0.1);
    expect(datums["MLW"]! - datums["MLLW"]!).toBeGreaterThan(0.1);
  });

  test("retains days with only one high and one low", () => {
    const { datums } = computeDatums(
      [{ name: "M1C", amplitude: 1, phase: 0 }],
      {},
    );
    expect(datums["MHW"]).toBe(1.574);
    expect(datums["MLW"]).toBe(-1.574);
    expect(datums["MHHW"]).toBeCloseTo(datums["MHW"]!, 2);
    expect(datums["MLLW"]).toBeCloseTo(datums["MLW"]!, 2);
  });
});

describe("computeDatumsFromObservations", () => {
  test("retains both parts of a record with a sampling-cadence change", () => {
    const start = Date.UTC(2020, 0, 1);
    const levels = [0, 1, 2, 1, 0, -1, -2, -1];
    const samples = [
      ...Array.from({ length: (24 * 400) / 3 }, (_, h) => ({
        time: new Date(start + h * 3 * 3600_000),
        level: 5 * levels[h % 8]!,
      })),
      ...Array.from({ length: 24 * 800 }, (_, h) => ({
        time: new Date(start + (24 * 400 + h) * 3600_000),
        level: levels[h % 8]!,
      })),
    ];
    const { datums } = computeDatumsFromObservations(samples)!;
    expect(datums["MHW"]).toBe(3.143);
    expect(datums["MLW"]).toBe(-3.143);
  });

  test("excludes incomplete days from higher-high and lower-low means", () => {
    const start = Date.UTC(2020, 0, 1);
    const levels = [
      2, 1.5, 1, 0, -1, -1.5, -2, -1.5, -1, 0, 0.5, 0.75, 1, 0.75, 0.5, 0, -0.5,
      -0.75, -1, -0.75, -0.5, 0, 1, 1.5,
    ];
    const samples = Array.from({ length: 24 * 400 }, (_, h) => ({
      time: new Date(start + h * 3600_000),
      level: levels[h % 24]!,
    })).filter((_, h) => h % 72 !== 1 && h % 72 !== 7);
    const { datums } = computeDatumsFromObservations(samples)!;
    expect(datums["MHHW"]).toBe(2);
    expect(datums["MLLW"]).toBe(-2);
  });

  test("omits higher-high and lower-low means without complete days", () => {
    const start = Date.UTC(2020, 0, 1);
    const samples = Array.from({ length: 24 * 400 }, (_, h) => ({
      time: new Date(start + h * 3600_000),
      level: Math.cos((h * Math.PI) / 6),
    })).filter((_, h) => h % 24 !== 1);
    const { datums } = computeDatumsFromObservations(samples)!;
    expect(Number.isFinite(datums["MHW"])).toBe(true);
    expect(Number.isFinite(datums["MLW"])).toBe(true);
    expect(datums).not.toHaveProperty("MHHW");
    expect(datums).not.toHaveProperty("MLLW");
  });

  test.each([1, 3])(
    "does not classify gaps in %i-hour observations",
    (step) => {
      const start = Date.UTC(2020, 0, 1);
      const levels = [0, 1, 2, 1, 0, -1, -2, -1];
      const samples = Array.from({ length: 24 * 400 }, (_, h) => ({
        time: new Date(start + h * step * 3600_000),
        level: levels[h % 8]!,
      })).filter((_, h) => h % 96 < 6 || h % 96 > 26);
      const { datums } = computeDatumsFromObservations(samples)!;
      expect(datums["MHW"]).toBe(2);
      expect(datums["MHHW"]).toBe(2);
      expect(datums["MLW"]).toBe(-2);
      expect(datums["MLLW"]).toBe(-2);
    },
  );

  test("includes hourly highs and lows on tidal-day boundaries", () => {
    const start = Date.UTC(2020, 0, 1);
    const levels = [
      2, 1.5, 1, 0, -1, -1.5, -2, -1.5, -1, 0, 0.5, 0.75, 1, 0.75, 0.5, 0, -0.5,
      -0.75, -1, -0.75, -0.5, 0, 1, 1.5,
    ];
    const samples = Array.from({ length: 24 * 400 + 1 }, (_, h) => ({
      time: new Date(start + h * 3600_000),
      level: levels[h % 24]!,
    }));
    const { datums } = computeDatumsFromObservations(samples)!;
    expect(datums["MHW"]).toBe(1.499);
    expect(datums["MLW"]).toBe(-1.5);
    expect(datums["MHHW"]! - datums["MHW"]!).toBeGreaterThan(0.4);
    expect(datums["MLW"]! - datums["MLLW"]!).toBeGreaterThan(0.4);
  });

  test("recovers MSL and range from a synthetic M2 tide in the gauge frame", () => {
    // 400 days (> 1 yr min) of hourly heights: M2 (12.42h) amplitude 2m about a
    // gauge mean of 5m. Datums should come back in that frame, not MSL=0.
    const samples: Sample[] = [];
    const t0 = Date.UTC(2000, 0, 1);
    for (let h = 0; h < 24 * 400; h++) {
      samples.push({
        time: new Date(t0 + h * 3600_000),
        level: 5 + 2 * Math.sin((2 * Math.PI * h) / 12.42),
      });
    }

    const result = computeDatumsFromObservations(samples)!;
    expect(result).not.toBeNull();
    const MSL = result.datums["MSL"]!;
    const MHW = result.datums["MHW"]!;
    const MLW = result.datums["MLW"]!;

    expect(MSL).toBeCloseTo(5, 1); // mean of hourly heights, real gauge frame
    expect(MHW).toBeGreaterThan(MSL);
    expect(MLW).toBeLessThan(MSL);
    expect(MHW).toBeCloseTo(7, 1); // amplitude recovered (hourly sampling)
    expect(MLW).toBeCloseTo(3, 1);
  });

  test("returns null for records shorter than the minimum span", () => {
    const samples: Sample[] = [];
    const t0 = Date.UTC(2000, 0, 1);
    for (let h = 0; h < 24 * 30; h++) {
      samples.push({ time: new Date(t0 + h * 3600_000), level: Math.sin(h) });
    }
    expect(computeDatumsFromObservations(samples)).toBeNull();
  });
});

describe("parseGeslaSamples", () => {
  test("keeps use_flag=1 rows, drops nulls/flagged, converts to UTC", () => {
    const text = [
      "# SITE NAME Test",
      "# TIME ZONE HOURS 0",
      "# NULL VALUE -99.9999",
      "#",
      "2020/01/01 00:00:00   1.2300 1 1",
      "2020/01/01 01:00:00 -99.9999 5 0", // missing -> excluded
      "2020/01/01 02:00:00   3.4000 3 0", // doubtful -> excluded
      "2020/01/01 03:00:00   2.1000 1 1",
    ].join("\n");

    const samples = parseGeslaSamples(text);
    expect(samples).toHaveLength(2);
    expect(samples[0]!.level).toBe(1.23);
    expect(samples[0]!.time.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(samples[1]!.level).toBe(2.1);
  });
});
