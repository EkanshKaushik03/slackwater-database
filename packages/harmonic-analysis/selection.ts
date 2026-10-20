import { astro, constituents, type Constituent } from "@slackwater/engine";
import type { Sample } from "./index.ts";

const modelByName = new Map<string, Constituent>();
for (const [key, model] of Object.entries(constituents)) {
  modelByName.set(key.toUpperCase(), model);
  modelByName.set(model.name.toUpperCase(), model);
  for (const alias of model.aliases)
    modelByName.set(alias.toUpperCase(), model);
}
const canonicalModels = [
  ...new Map(
    Object.values(constituents)
      .filter((model) => model.speed > 0)
      .map((model) => [model.name, model]),
  ).values(),
];

export function spreadSample<T>(
  points: readonly T[],
  count: number,
  salt: number,
): T[] {
  if (points.length <= count) return [...points];
  return Array.from({ length: count }, (_, index) => {
    const low = Math.floor((index * points.length) / count);
    const high = Math.floor(((index + 1) * points.length) / count);
    return points[low + ((index * 104_729 + salt) % Math.max(1, high - low))]!;
  });
}

export function selectExtraConstituents(
  samples: Sample[],
  residuals: number[],
  excludedNames: readonly string[],
  count: number,
  minimumSeparation = 1e-9,
): string[] {
  if (samples.length !== residuals.length)
    throw new Error("sample and residual lengths do not match");
  const excluded = new Set(
    excludedNames.map(
      (name) => modelByName.get(name.toUpperCase())?.name ?? name,
    ),
  );
  const usedSpeeds = excludedNames.flatMap((name) => {
    const model = modelByName.get(name.toUpperCase());
    return model ? [model.speed] : [];
  });
  const astronomy = samples.map((sample) => astro(new Date(sample.t)));
  return canonicalModels
    .filter((model) => !excluded.has(model.name))
    .flatMap((model) => {
      let cc = 0;
      let cs = 0;
      let ss = 0;
      let cy = 0;
      let sy = 0;
      samples.forEach((_, index) => {
        const a = astronomy[index]!;
        const { f, u } = model.correction(a);
        const argument = (model.value(a) + u) * (Math.PI / 180);
        const cosine = f * Math.cos(argument);
        const sine = f * Math.sin(argument);
        cc += cosine * cosine;
        cs += cosine * sine;
        ss += sine * sine;
        cy += cosine * residuals[index]!;
        sy += sine * residuals[index]!;
      });
      const determinant = cc * ss - cs * cs;
      if (determinant === 0) return [];
      const p = (cy * ss - sy * cs) / determinant;
      const q = (sy * cc - cy * cs) / determinant;
      return [
        { name: model.name, speed: model.speed, amplitude: Math.hypot(p, q) },
      ];
    })
    .sort((left, right) =>
      right.amplitude === left.amplitude
        ? left.name.localeCompare(right.name)
        : right.amplitude - left.amplitude,
    )
    .filter(({ speed }) => {
      if (
        usedSpeeds.some(
          (used) =>
            Math.abs(used - speed) < minimumSeparation ||
            Math.abs(used - speed) <= 1e-9,
        )
      )
        return false;
      usedSpeeds.push(speed);
      return true;
    })
    .slice(0, count)
    .map(({ name }) => name);
}
