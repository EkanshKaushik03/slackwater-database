import { fileURLToPath } from "node:url";
import { createTidePredictor } from "@slackwater/engine";
import { FIXTURES_DIR, verifySnapshot } from "./import.ts";
import { parsePredictions } from "./jhod.ts";

export async function validate(dir = FIXTURES_DIR) {
  const { harmonics, contents } = await verifySnapshot(dir);
  return harmonics.map((h) => {
    const predictor = createTidePredictor(h.constituents);
    const points = parsePredictions(contents.get(`${h.id}-gauge.html`)!);
    const errors = points.map(
      (p) =>
        predictor.getWaterLevelAtTime({ time: p.time }).level + h.z0 - p.level,
    );
    const rmse = Math.sqrt(
      errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length,
    );
    const maximum = Math.max(...errors.map(Math.abs));
    // Project regression limits, not a claim about the publisher's prediction uncertainty.
    if (!Number.isFinite(rmse) || rmse > 0.03 || maximum > 0.05)
      throw new Error(
        `${h.id}: JHOD prediction comparison failed (RMSE ${rmse}, max ${maximum} m)`,
      );
    return { id: h.id, name: h.name, points: points.length, rmse, maximum };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validate()
    .then((results) => console.table(results))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
