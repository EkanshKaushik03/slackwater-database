import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTidePredictor } from "@slackwater/engine";
import { DATA_DIR } from "@slackwater/stations";
import type { StationData } from "@slackwater/database";
import { FIXTURES_DIR, stationIds, verifySnapshot } from "./import.ts";
import { parsePredictions } from "./jhod.ts";

export async function validate(dir = FIXTURES_DIR, dataDir = DATA_DIR) {
  const { harmonics, contents } = await verifySnapshot(dir);
  const imported = await stationIds(join(dataDir, "jhod"));
  const expected = harmonics.map((h) => h.id).sort();
  if (JSON.stringify(imported.sort()) !== JSON.stringify(expected))
    throw new Error(
      `JHOD snapshot and imported station set differ: expected ${expected.join(", ")}; imported ${imported.join(", ")}`,
    );
  return Promise.all(
    harmonics.map(async (h) => {
      const station = JSON.parse(
        await readFile(join(dataDir, "jhod", `${h.id}.json`), "utf8"),
      ) as StationData;
      const msl = station.datums["MSL"];
      const datum = station.chart_datum && station.datums[station.chart_datum];
      if (
        station.source.id !== h.id ||
        typeof msl !== "number" ||
        typeof datum !== "number"
      )
        throw new Error(`${h.id}: invalid imported station identity or datum`);
      const predictor = createTidePredictor(station.harmonic_constituents);
      const points = parsePredictions(contents.get(`${h.id}-gauge.html`)!);
      const errors = points.map(
        (p) =>
          predictor.getWaterLevelAtTime({ time: p.time }).level +
          msl -
          datum -
          p.level,
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
    }),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validate()
    .then((results) => console.table(results))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
