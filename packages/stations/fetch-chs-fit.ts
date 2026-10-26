/**
 * Snapshot a CHS current results release into
 * metadata/chs-current-validation/<tag>.json: its release, stamp, engine,
 * scorer, database and newest fields, and each gate's `chs_fit` alone. Station
 * files cite the snapshot in `chs_fit.evidence`, and `npm run validate` checks
 * them against it.
 *
 * Run manually, review the diff, and commit the snapshot:
 *   npm run refresh:chs-fit -w packages/stations -- <tag>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CHS_FIT_EVIDENCE, chsFitProblems } from "./station-files.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(root, "metadata", "chs-current-validation");
const RELEASES =
  "https://github.com/openwatersio/chs-current-validation/releases/download";

const sortKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sortKeys)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([key, inner]) => [key, sortKeys(inner)]),
        )
      : value;

async function main() {
  const tag = process.argv[2];
  if (!tag || !CHS_FIT_EVIDENCE.test(tag))
    throw new Error(
      `usage: npm run refresh:chs-fit -w packages/stations -- <tag>, a results release tag like fit-2026-10-22-8f85912-r2 (got ${tag})`,
    );
  const url = `${RELEASES}/${tag}/dispositions.json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const source = (await response.json()) as {
    release: string;
    stamp: string;
    engine: string;
    scorer: number;
    database: string;
    newest: { grid: number; fit_end: string };
    gates: Record<string, { chs_fit: unknown }>;
  };
  if (source.release !== tag)
    throw new Error(`${url} is release ${source.release}, not ${tag}`);
  const { release, stamp, engine, scorer, database, newest } = source;
  const gates = Object.fromEntries(
    Object.entries(source.gates).map(([id, gate]) => [id, gate.chs_fit]),
  );
  const rejected = Object.entries(gates).flatMap(([id, fit]) =>
    chsFitProblems({ ...(fit as object), evidence: tag }).map(
      (problem) => `${id}: ${problem}`,
    ),
  );
  if (rejected.length)
    throw new Error(
      `${url} holds chs_fit shapes this repo rejects:\n  ${rejected.join("\n  ")}`,
    );
  const snapshot = sortKeys({
    release,
    stamp,
    engine,
    scorer,
    database,
    newest,
    gates,
  });
  mkdirSync(OUT, { recursive: true });
  const path = join(OUT, `${tag}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n");
  console.log(`wrote ${Object.keys(gates).length} gates to ${path}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
