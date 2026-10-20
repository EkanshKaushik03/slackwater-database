import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildStation,
  parseHarmonics,
  parseInventory,
  parsePredictions,
  resolveConstituent,
} from "../jhod.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const inventory = () => parseInventory(fixture("index.html"));
const sasebo = () => inventory().find((s) => s.id === "0154")!;
const html = () => fixture("0154-constants.html");

describe("JHOD source", () => {
  it("reads precise gauge positions from the map inventory", () => {
    expect(inventory()).toHaveLength(89);
    expect(sasebo()).toMatchObject({
      name: "Sasebo",
      latitude: 33.158055555556,
      longitude: 129.72388888889,
    });
    expect(() => parseInventory("<p>unavailable</p>")).toThrow(/inventory/i);
    expect(() =>
      parseInventory(
        fixture("index.html").replace("45.407777777778", "95.407777777778"),
      ),
    ).toThrow(/position/i);
  });

  it("converts local meridian lag to Greenwich and preserves centimetre precision", () => {
    const result = parseHarmonics(html(), sasebo());
    expect(result.constituents).toHaveLength(60);
    expect(result).toMatchObject({
      z0: 1.65,
      epoch: { start: "2011-01-01", end: "2020-12-31" },
      seasonalEpoch: { start: "2011-01-01", end: "2020-12-31" },
    });
    expect(result.constituents.find((c) => c.name === "M2")).toMatchObject({
      amplitude: 0.8121,
    });
    expect(result.constituents.find((c) => c.name === "M2")!.phase).toBeCloseTo(
      340.82222222222,
      7,
    );
    expect(result.constituents.find((c) => c.name === "Sa")).toEqual({
      name: "Sa",
      amplitude: 0.1945,
      phase: 148.13,
    });
    expect(result.constituents.some((c) => c.name === "M1C")).toBe(true);
  });

  it("resolves JHOD names by both name and published frequency", () => {
    expect(resolveConstituent("M1", 14.4920521)).toBe("M1C");
    expect(resolveConstituent("σ1", 12.9271398)).toBe("sigma1");
    expect(resolveConstituent("OQ2", 27.3416964)).toBe("OQ2");
    expect(() => resolveConstituent("M1", 14.4966939)).toThrow(/constituent/i);
    expect(() => resolveConstituent("UNKNOWN", 28.9841042)).toThrow(
      /constituent/i,
    );
  });

  it("keeps a measured zero and rejects missing, negative and duplicate amplitudes", () => {
    const zero = html().replace("19.45", "0.00");
    expect(parseHarmonics(zero, sasebo()).constituents[0]!.amplitude).toBe(0);
    for (const value of ["", "NaN", "-1.00"]) {
      expect(() =>
        parseHarmonics(html().replace("19.45", value), sasebo()),
      ).toThrow();
    }
    expect(() =>
      parseHarmonics(html().replace(">Ssa<", ">Sa<"), sasebo()),
    ).toThrow();
    expect(() =>
      parseHarmonics(html().replace("2011-2020", "2021-2020"), sasebo()),
    ).toThrow(/period/i);
    expect(() =>
      parseHarmonics(html().replace("（cm）", "（m）"), sasebo()),
    ).toThrow(/unit/i);
  });

  it("retains a separate analysis period for the seasonal constituents", () => {
    const page = html().replace("2011-2020", "2016-2020");
    expect(parseHarmonics(page, sasebo())).toMatchObject({
      epoch: { start: "2016-01-01", end: "2020-12-31" },
      seasonalEpoch: { start: "2011-01-01", end: "2020-12-31" },
    });
  });

  it("records the span of an analysis with an explicitly omitted year", () => {
    expect(
      parseHarmonics(
        fixture("0158-constants.html"),
        inventory().find((s) => s.id === "0158")!,
      ).seasonalEpoch,
    ).toEqual({ start: "2011-01-01", end: "2019-12-31" });
  });

  it("uses JHOD's published NLLW and Z0 rather than deriving a new chart zero", () => {
    const station = buildStation(parseHarmonics(html(), sasebo()));
    expect(station).toMatchObject({
      country: "Japan",
      timezone: "Asia/Tokyo",
      chart_datum: "NLLW",
      datums: { MSL: 1.65, NLLW: 0 },
      source: { id: "0154", published_harmonics: true },
      license: { commercial_use: true },
    });
  });

  it("reads hourly predictions in JST on JHOD's depth datum", () => {
    const points = parsePredictions(fixture("0154-gauge.html"));
    expect(points).toHaveLength(24);
    expect(points[0]).toEqual({
      time: new Date("2026-10-19T15:00:00Z"),
      level: 1.82,
    });
    expect(points[23]!.level).toBe(1.54);
    expect(() => parsePredictions("<p>unavailable</p>")).toThrow(/prediction/i);
  });
});
