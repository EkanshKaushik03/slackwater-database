import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { CHS_FIT_EVIDENCE, type StationFile } from "./station-files.ts";

/** The snapshot of one results release: its `dispositions.json`, trimmed. */
export interface ChsFitSnapshot {
  release: string;
  stamp: string;
  engine: string;
  scorer: number;
  database: string;
  newest: { grid: number; fit_end: string };
  /** Each gate's `chs_fit`, keyed by the owned station file's first source. */
  gates: Record<string, Record<string, unknown>>;
}

/** Orders results release tags oldest first: by date, then run number. */
export function compareTags(a: string, b: string): number {
  const key = (tag: string) => {
    const [, date, run] = /^fit-(\d{4}-\d{2}-\d{2})-[0-9a-f]{7}-r(\d+)$/.exec(
      tag,
    )!;
    return { date: date!, run: Number(run) };
  };
  const [x, y] = [key(a), key(b)];
  return x.date < y.date ? -1 : x.date > y.date ? 1 : x.run - y.run;
}

/**
 * What disagrees between each owned file's `chs_fit` and the results releases.
 * A gate must cite the newest snapshot that lists it, and match it. Each
 * problem starts with the file's repo-relative path.
 */
export function evidenceProblems(
  files: StationFile[],
  snapshotDir: string,
): string[] {
  const read = (tag: string) =>
    JSON.parse(
      readFileSync(join(snapshotDir, `${tag}.json`), "utf8"),
    ) as ChsFitSnapshot;
  const tags = existsSync(snapshotDir)
    ? readdirSync(snapshotDir)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.slice(0, -".json".length))
        .filter((tag) => CHS_FIT_EVIDENCE.test(tag))
        .sort(compareTags)
    : [];
  // The newest snapshot (by tag, not by file system order) listing each gate.
  const newest = new Map<string, string>();
  for (const tag of tags) {
    const snapshot = read(tag);
    if (snapshot.release !== tag) continue;
    for (const id of Object.keys(snapshot.gates ?? {})) newest.set(id, tag);
  }

  return files.flatMap((file) => {
    const id = file.sources[0]!;
    const expected = newest.get(id);
    const fit = file.chs_fit;
    if (!fit)
      return expected
        ? [
            file.derived
              ? `${file.file}: has no chs_fit, but ${expected} measured gate ${id}, which the file derives; check the snapshot or the file's derived block`
              : `${file.file}: has no chs_fit, but ${expected} measured gate ${id}`,
          ]
        : [];
    const path = join(snapshotDir, `${fit.evidence}.json`);
    const where = `${file.file}: chs_fit`;
    if (!existsSync(path))
      return [`${where} cites ${fit.evidence}, but ${path} does not exist`];
    const snapshot = read(fit.evidence);
    if (snapshot.release !== fit.evidence)
      return [
        `${where} cites ${fit.evidence}, but ${path} is release ${snapshot.release}`,
      ];
    const gate = snapshot.gates?.[id];
    if (!gate)
      return [`${where} cites ${fit.evidence}, which lacks gate ${id}`];
    if (expected !== fit.evidence)
      return [
        `${where} cites ${fit.evidence}, but the newest snapshot listing gate ${id} is ${expected}; cite ${expected}`,
      ];
    const { evidence: _evidence, miss_context: _context, ...ours } = fit;
    const differing = [...new Set([...Object.keys(ours), ...Object.keys(gate)])]
      .sort()
      .filter(
        (key) =>
          !isDeepStrictEqual((ours as Record<string, unknown>)[key], gate[key]),
      );
    return differing.length
      ? [
          `${where} differs from ${fit.evidence} for gate ${id} in ${differing.join(", ")}`,
        ]
      : [];
  });
}
