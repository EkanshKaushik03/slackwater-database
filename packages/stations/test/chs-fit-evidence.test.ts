import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StationFile } from "../station-files.ts";
import { evidenceProblems } from "../chs-fit-evidence.ts";

const TAG = "fit-2026-10-22-8f85912-r2";
const FILE = "stations/current/ca/bc/active-pass.yml";
const GATE = {
  tier: "bounded",
  days: 210,
  slack_bound_minutes: 45,
  provisional_slack_minutes: 30,
};

let dir: string;
const snapshot = (
  release: string,
  gates: object = { "chs-active-pass": GATE },
) =>
  JSON.stringify({
    release,
    stamp: "2026-10-22",
    engine: "x",
    scorer: 1,
    database: "d",
    newest: { grid: 1, fit_end: "2026-10-22" },
    gates,
  });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "chs-fit-"));
  writeFileSync(join(dir, `${TAG}.json`), snapshot(TAG));
  writeFileSync(
    join(dir, "fit-2026-10-22-8f85912-r3.json"),
    snapshot("fit-2026-10-22-8f85912-r1"),
  );
  writeFileSync(
    join(dir, "fit-2026-10-22-8f85912-r4.json"),
    snapshot("fit-2026-10-22-8f85912-r4", {}),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const station = (chs_fit?: object): StationFile =>
  ({
    kind: "current",
    country: "CA",
    slug: "active-pass",
    file: FILE,
    sources: ["chs-active-pass"],
    ...(chs_fit && { chs_fit }),
  }) as StationFile;

describe("evidenceProblems", () => {
  it("accepts a chs_fit equal to the snapshot gate plus evidence and miss_context", () => {
    const file = station({
      ...GATE,
      miss_context: "rapids",
      evidence: TAG,
    });
    expect(evidenceProblems([file], dir)).toEqual([]);
  });

  it("names the field that differs", () => {
    const file = station({ ...GATE, slack_bound_minutes: 40, evidence: TAG });
    const problems = evidenceProblems([file], dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
    expect(problems[0]).toContain("slack_bound_minutes");
  });

  it("names a missing snapshot", () => {
    const tag = "fit-2026-10-22-8f85912-r9";
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: tag })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
    expect(problems[0]).toContain(`${tag}.json`);
  });

  it("rejects a snapshot whose release differs from its file name", () => {
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: "fit-2026-10-22-8f85912-r3" })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
  });

  it("rejects a gate absent from the snapshot", () => {
    const problems = evidenceProblems(
      [station({ ...GATE, evidence: "fit-2026-10-22-8f85912-r4" })],
      dir,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(FILE);
    expect(problems[0]).toContain("chs-active-pass");
  });

  it("ignores a station with no chs_fit", () => {
    expect(evidenceProblems([station()], dir)).toEqual([]);
  });

  it("fails a station whose chs_fit was deleted while another cites the snapshot", () => {
    const kept = station({ ...GATE, evidence: TAG });
    const gone = {
      ...station(),
      file: "stations/current/ca/bc/first-narrows.yaml",
      sources: ["chs-first-narrows"],
    } as StationFile;
    writeFileSync(
      join(dir, "fit-2026-10-22-8f85912-r5.json"),
      snapshot("fit-2026-10-22-8f85912-r5", {
        "chs-active-pass": GATE,
        "chs-first-narrows": GATE,
      }),
    );
    const cites = station({ ...GATE, evidence: "fit-2026-10-22-8f85912-r5" });
    const problems = evidenceProblems([cites, gone], dir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("first-narrows.yaml");
    expect(problems[0]).toContain("fit-2026-10-22-8f85912-r5");
    expect(evidenceProblems([kept], dir)).toEqual([]);
  });

  it("passes a snapshot gate that has no station file", () => {
    writeFileSync(
      join(dir, "fit-2026-10-22-8f85912-r6.json"),
      snapshot("fit-2026-10-22-8f85912-r6", {
        "chs-active-pass": GATE,
        "chs-nowhere": GATE,
      }),
    );
    const file = station({ ...GATE, evidence: "fit-2026-10-22-8f85912-r6" });
    expect(evidenceProblems([file], dir)).toEqual([]);
  });
});
