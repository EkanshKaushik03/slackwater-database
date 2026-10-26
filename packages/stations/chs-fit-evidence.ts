import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { StationFile } from "./station-files.ts";

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

/**
 * What disagrees between each file's `chs_fit` and the results release it
 * cites. Each problem starts with the file's repo-relative path.
 */
export function evidenceProblems(
  files: StationFile[],
  snapshotDir: string,
): string[] {
  const each = files.flatMap((file) => {
    const fit = file.chs_fit;
    if (!fit) return [];
    const path = join(snapshotDir, `${fit.evidence}.json`);
    const where = `${file.file}: chs_fit`;
    if (!existsSync(path))
      return [`${where} cites ${fit.evidence}, but ${path} does not exist`];
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as ChsFitSnapshot;
    if (snapshot.release !== fit.evidence)
      return [
        `${where} cites ${fit.evidence}, but ${path} is release ${snapshot.release}`,
      ];
    const id = file.sources[0]!;
    const gate = snapshot.gates?.[id];
    if (!gate)
      return [`${where} cites ${fit.evidence}, which lacks gate ${id}`];
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
  // A snapshot some file cites lists the gates the release measured; an owned
  // station file for one of them must keep its block, or the gate ships online.
  const cited = new Set(
    files.flatMap((f) => (f.chs_fit ? [f.chs_fit.evidence] : [])),
  );
  const owned = new Map(files.map((f) => [f.sources[0], f]));
  const missing = [...cited].sort().flatMap((tag) => {
    const path = join(snapshotDir, `${tag}.json`);
    if (!existsSync(path)) return [];
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as ChsFitSnapshot;
    if (snapshot.release !== tag) return [];
    return Object.keys(snapshot.gates ?? {}).flatMap((id) => {
      const file = owned.get(id);
      return file && !file.chs_fit
        ? [`${file.file}: has no chs_fit, but ${tag} measured gate ${id}`]
        : [];
    });
  });
  return [...each, ...missing];
}
