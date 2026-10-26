/**
 * Check every snapshot in metadata/chs-current-validation/ against the release
 * it names: download that tag's dispositions.json, build the snapshot from it
 * as refresh:chs-fit does, and compare with the committed file. Exits 1 on a
 * mismatch or a missing release; a network error or timeout warns and exits 0.
 *   npm run validate:chs-fit -w packages/stations
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSnapshot,
  snapshotDifferences,
  type Dispositions,
} from "./chs-fit-snapshot.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(root, "metadata", "chs-current-validation");
const RELEASES =
  "https://github.com/openwatersio/chs-current-validation/releases/download";

const failures: string[] = [];
for (const name of readdirSync(DIR)
  .filter((n) => n.endsWith(".json"))
  .sort()) {
  const tag = name.slice(0, -".json".length);
  const file = `metadata/chs-current-validation/${name}`;
  const url = `${RELEASES}/${tag}/dispositions.json`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `::warning::Could not check ${file} against ${tag}: ${message}`,
    );
    continue;
  }
  if (response.status === 404) {
    failures.push(
      `${file}: release ${tag} has no dispositions.json (HTTP 404)`,
    );
    continue;
  }
  if (!response.ok) {
    console.log(
      `::warning::Could not check ${file} against ${tag}: HTTP ${response.status}`,
    );
    continue;
  }
  try {
    const built = buildSnapshot((await response.json()) as Dispositions, tag);
    const committed = JSON.parse(readFileSync(join(DIR, name), "utf8"));
    for (const difference of snapshotDifferences(committed, built))
      failures.push(`${file}: differs from release ${tag}: ${difference}`);
  } catch (error) {
    failures.push(`${file}: ${error instanceof Error ? error.message : error}`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
