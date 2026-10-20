import { expect, test } from "vitest";
import { astro, createTidePredictor, constituents } from "@slackwater/engine";
import { selectExtraConstituents } from "@slackwater/harmonic-analysis";
import {
  fitSeries,
  heightGate,
  resolvedNames,
  storedHeight,
} from "./harmonics.ts";

test("resolves frequencies over the training span and keeps majors over aliases", () => {
  expect(resolvedNames(["N2", "3N2", "M2"], 367 * 24)).toEqual(["N2", "M2"]);
  expect(resolvedNames(["Sa", "Ssa"], 367 * 24)).toEqual(["Sa", "Ssa"]);
  const picked = resolvedNames(
    Object.values(constituents).map((c) => c.name),
    367 * 24,
  );
  const speeds = picked.map((n) => constituents[n]!.speed);
  expect(
    speeds.every((s, i) =>
      speeds.slice(i + 1).every((v) => Math.abs(s - v) >= 360 / (367 * 24)),
    ),
  ).toBe(true);
});

test("residual selection cannot reintroduce an unresolved neighbour of a major", () => {
  const spanHours = 367 * 24,
    start = Date.parse("2026-01-02T00:00Z"),
    model = constituents["3N2"]!;
  const samples = Array.from({ length: 400 }, (_, i) => ({
    t: start + (i * spanHours * 3600000) / 399,
    level: 0,
  }));
  const residuals = samples.map((s) => {
    const a = astro(new Date(s.t)),
      { f, u } = model.correction(a);
    return f * Math.cos(((model.value(a) + u) * Math.PI) / 180);
  });
  const gap = 360 / spanHours;
  const selected = selectExtraConstituents(samples, residuals, ["N2"], 20, gap);
  expect(selected.length).toBeGreaterThan(0);
  expect(
    selected.every(
      (n) =>
        Math.abs(constituents[n]!.speed - constituents["N2"]!.speed) >= gap,
    ),
  ).toBe(true);
});

const terms = [
  { name: "M2", amplitude: 0.7, phase: 123.45 },
  { name: "S2", amplitude: 0.23, phase: 246.8 },
  { name: "Sa", amplitude: 0.08, phase: 34.56 },
];
function synthetic(start: number, days: number, count: number) {
  const predictor = createTidePredictor(terms, { offset: 0.123 });
  return Array.from({ length: count }, (_, i) => {
    const t = start + (i * days * 86400000) / (count - 1);
    return {
      t,
      level: predictor.getWaterLevelAtTime({ time: new Date(t) }).level,
    };
  });
}

test("recovers Greenwich phases and a mean offset from training only", () => {
  const start = Date.parse("2026-01-02T00:00Z");
  const training = synthetic(start, 367, 1600);
  const validation = synthetic(start + 370 * 86400000, 350, 1000);
  const result = fitSeries(training, validation, {
    names: ["M2", "S2", "Sa"],
    extra: 0,
  });
  expect(result.accepted).toBe(true);
  expect(result.offset).toBeCloseTo(0.123, 3);
  expect(result.constituents).toEqual(terms);
  expect(result.height.max).toBeLessThan(0.001);
  const changed = fitSeries(
    training,
    validation.map((s) => ({ ...s, level: s.level + 0.5 })),
    { names: ["M2", "S2", "Sa"], extra: 0 },
  );
  expect(changed.accepted).toBe(false);
  expect(changed.constituents).toEqual(result.constituents);
  expect(changed.offset).toBe(result.offset);
});

test("rejects overlapping windows and an insufficient annual training span", () => {
  const t = Date.parse("2026-01-02T00:00Z");
  expect(() =>
    fitSeries(synthetic(t, 367, 100), synthetic(t, 350, 100)),
  ).toThrow(/overlap/i);
  expect(() =>
    fitSeries(synthetic(t, 180, 100), synthetic(t + 370 * 86400000, 350, 100)),
  ).toThrow(/annual/i);
});

test("publication requires finite height metrics and independent-fit stability", () => {
  const height = { rms: 0.018, p95: 0.035, max: 0.09 };
  expect(heightGate(height, 0.004)).toBe(true);
  expect(heightGate(height, 0.006)).toBe(false);
  expect(heightGate({ ...height, rms: NaN }, 0.004)).toBe(false);
  expect(heightGate({ ...height, p95: 0.05 }, 0.004)).toBe(false);
});

test("validates serialized constants, including their fitted constant term", () => {
  const validation = synthetic(Date.parse("2027-01-05T00:00Z"), 350, 1000);
  const stored = [...terms, { name: "Zo", amplitude: 0.123, phase: 0 }];
  expect(storedHeight(stored, validation).max).toBeLessThan(1e-9);
  expect(
    storedHeight(
      stored.map((c) => (c.name === "M2" ? { ...c, phase: c.phase + 30 } : c)),
      validation,
    ).rms,
  ).toBeGreaterThan(0.1);
});

test("refuses malformed stored constituents even at a weak-tide station", () => {
  const samples = synthetic(Date.parse("2027-01-05T00:00Z"), 350, 100);
  expect(() =>
    storedHeight([{ name: "unknown", amplitude: 0, phase: 0 }], samples),
  ).toThrow(/constituent/i);
  expect(() =>
    storedHeight([{ name: "M2", amplitude: NaN, phase: 0 }], samples),
  ).toThrow(/constituent/i);
});
