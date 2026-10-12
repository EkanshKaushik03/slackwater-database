/**
 * Bring every station file up to date with the catalogue. Each record's quality
 * is evaluated again. A new record gets a station of its own, and a record the
 * provider dropped moves to `retired_sources`, returning if the provider
 * publishes it again. `computed` records each record's position, coastline
 * verdict and quality. Curated fields and comments are kept. A station never
 * moves on its own: renaming or refiling one is a `git mv` plus a
 * `redirect_from` entry.
 *
 * Usage: [STATIONS_RETIRE=1] npm run stations
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { evaluateQuality } from "./evaluate-quality.ts";
import { loadProductionCatalogue } from "./load-catalogue.ts";
import {
  newlyRetired,
  planStationFiles,
  readStationFiles,
  RETIRE_LIMIT,
  ROOT,
} from "./station-files.ts";

const files = readStationFiles();
const quality = new Map((await evaluateQuality()).map((q) => [q.id, q]));
const catalogue = await loadProductionCatalogue(ROOT, files, quality);
const planned = await planStationFiles(
  files,
  catalogue.stations,
  catalogue.routes,
);

// A provider dropping many records at once is more often a broken import than
// decommissioned gauges, and retiring them takes their pages down. An
// environment variable, since npm keeps a flag from reaching a workspace script.
const retiring = newlyRetired(files, planned);
if (retiring.length > RETIRE_LIMIT && process.env["STATIONS_RETIRE"] !== "1")
  throw new Error(
    `${retiring.length} records would retire, more than ${RETIRE_LIMIT}; check the import, then rerun with STATIONS_RETIRE=1 npm run stations:\n${retiring.slice(0, 20).join("\n")}`,
  );
for (const { file, from, text } of planned) {
  if (from) rmSync(join(ROOT, from));
  mkdirSync(dirname(join(ROOT, file)), { recursive: true });
  writeFileSync(join(ROOT, file), text);
  console.log(from ? `moved: ${from} -> ${file}` : `wrote: ${file}`);
}
console.log(`stations: ${planned.length} station files changed`);
