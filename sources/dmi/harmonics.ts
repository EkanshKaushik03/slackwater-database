import { constituents, createTidePredictor } from "@slackwater/engine";
import {
  fitHarmonics,
  selectExtraConstituents,
  spreadSample,
  type Sample,
  type HarmonicConstituent,
} from "@slackwater/harmonic-analysis";

const MAJORS =
  "M2 S2 N2 K1 O1 K2 P1 Q1 Sa Ssa Mm Mf MSf 2Q1 sigma1 rho1 M1 chi1 pi1 S1 psi1 phi1 theta1 J1 OO1 2N2 mu2 nu2 lambda2 L2 T2 R2 eta2 M3 MK3 MO3 SO3 SK3 MN4 M4 MS4 MK4 S4 SK4 2MK5 2SK5 M6 2MS6 2SM6 2MK6 MSK6 2MN6 M8 M10 M12".split(
    " ",
  );
const models = new Map(Object.values(constituents).map((c) => [c.name, c]));
export type Metrics = { rms: number; p95: number; max: number };
export type FitResult = {
  accepted: boolean;
  constituents: HarmonicConstituent[];
  offset: number;
  height: Metrics;
  stabilityRms: number;
  training: { start: string; end: string; count: number };
  validation: { start: string; end: string; count: number };
};

export function resolvedNames(names: string[], spanHours: number): string[] {
  const speeds: number[] = [];
  return names.filter((name) => {
    const c = models.get(name);
    // Rayleigh resolution: one relative cycle in the training span (Codiga 2011, UTide).
    if (
      !c ||
      c.speed <= 0 ||
      speeds.some((s) => Math.abs(s - c.speed) < 360 / spanHours)
    )
      return false;
    speeds.push(c.speed);
    return true;
  });
}

export function heightGate(height: Metrics, stabilityRms: number): boolean {
  return (
    [height.rms, height.p95, height.max, stabilityRms].every(
      (n) => Number.isFinite(n) && n >= 0,
    ) &&
    height.rms <= 0.02 &&
    height.p95 <= 0.04 &&
    height.max <= 0.1 &&
    stabilityRms <= 0.005
  );
}

export function storedHeight(
  terms: HarmonicConstituent[],
  samples: Sample[],
): Metrics {
  if (!samples.length) throw new Error("Missing validation samples");
  if (
    !Array.isArray(terms) ||
    !terms.length ||
    terms.some(
      (c) =>
        !c ||
        !models.has(c.name) ||
        !Number.isFinite(c.amplitude) ||
        c.amplitude < 0 ||
        !Number.isFinite(c.phase),
    )
  )
    throw new Error("Invalid stored constituent");
  const predictor = createTidePredictor(terms, { offset: false });
  const errors = samples
    .map((s) =>
      Math.abs(
        predictor.getWaterLevelAtTime({ time: new Date(s.t) }).level - s.level,
      ),
    )
    .sort((a, b) => a - b);
  return {
    rms: Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length),
    p95: errors[Math.ceil(errors.length * 0.95) - 1]!,
    max: errors.at(-1)!,
  };
}

function fitted(samples: Sample[], names: string[]) {
  const fit = fitHarmonics(samples, names, { solver: "svd" });
  const predictor = createTidePredictor(fit, { offset: false });
  const offset = Number(
    (
      samples.reduce(
        (sum, s) =>
          sum +
          s.level -
          predictor.getWaterLevelAtTime({ time: new Date(s.t) }).level,
        0,
      ) / samples.length
    ).toFixed(3),
  );
  return { fit, offset, predictor: createTidePredictor(fit, { offset }) };
}

export function fitSeries(
  training: Sample[],
  validation: Sample[],
  options: { names?: string[]; extra?: number } = {},
): FitResult {
  for (const rows of [training, validation]) {
    if (
      rows.length < 100 ||
      rows.some(
        (s, i) =>
          !Number.isFinite(s.level) ||
          !Number.isFinite(s.t) ||
          (i > 0 && s.t <= rows[i - 1]!.t),
      )
    )
      throw new Error("Insufficient, non-finite or unordered samples");
  }
  if (training.at(-1)!.t >= validation[0]!.t)
    throw new Error("Training and validation overlap");
  const spanHours = (training.at(-1)!.t - training[0]!.t) / 3600000;
  if (spanHours < 365.25 * 24)
    throw new Error("Training must span a complete annual cycle");
  const names = resolvedNames(options.names ?? MAJORS, spanHours);
  const firstRows = spreadSample(training, 4000, 17),
    secondRows = spreadSample(training, 4000, 18);
  const baseline = fitted(firstRows, names);
  const residual = firstRows.map(
    (s) =>
      s.level -
      baseline.predictor.getWaterLevelAtTime({ time: new Date(s.t) }).level,
  );
  const extras =
    options.extra === 0
      ? []
      : selectExtraConstituents(
          firstRows,
          residual,
          names,
          options.extra ?? 40,
          360 / spanHours,
        );
  const chosen = [...names, ...extras];
  const first = fitted(firstRows, chosen),
    second = fitted(secondRows, chosen);
  const errors: number[] = [];
  let squares = 0,
    stability = 0;
  for (const s of validation) {
    const time = new Date(s.t);
    const a = first.predictor.getWaterLevelAtTime({ time }).level;
    const b = second.predictor.getWaterLevelAtTime({ time }).level;
    const error = a - s.level;
    squares += error * error;
    stability += (a - b) ** 2;
    errors.push(Math.abs(error));
  }
  errors.sort((a, b) => a - b);
  const height = {
    rms: Math.sqrt(squares / errors.length),
    p95: errors[Math.ceil(errors.length * 0.95) - 1]!,
    max: errors.at(-1)!,
  };
  const stabilityRms = Math.sqrt(stability / errors.length);
  const bounds = (rows: Sample[]) => ({
    start: new Date(rows[0]!.t).toISOString(),
    end: new Date(rows.at(-1)!.t).toISOString(),
    count: rows.length,
  });
  return {
    accepted: heightGate(height, stabilityRms),
    constituents: first.fit,
    offset: first.offset,
    height,
    stabilityRms,
    training: bounds(training),
    validation: bounds(validation),
  };
}
