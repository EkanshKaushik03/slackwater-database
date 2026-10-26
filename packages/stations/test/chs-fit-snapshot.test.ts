import { describe, expect, it } from "vitest";
import { buildSnapshot, snapshotDifferences } from "../chs-fit-snapshot.ts";

const TAG = "fit-2026-10-22-8f85912-r2";
const source = (gates: Record<string, unknown>) => ({
  release: TAG,
  stamp: "s",
  engine: "e",
  scorer: 1,
  database: "d",
  newest: { grid: 1, fit_end: "2026-10-22" },
  gates: Object.fromEntries(
    Object.entries(gates).map(([id, chs_fit]) => [
      id,
      { status: "x", chs_fit },
    ]),
  ),
});
const FINAL = { tier: "final", days: 60 };
const ONLINE = {
  tier: "online",
  miss: { clause: "slack_median", value: null },
};

describe("buildSnapshot", () => {
  it("keeps each gate's chs_fit alone", () => {
    const built = buildSnapshot(source({ a: FINAL }), TAG);
    expect(built["gates"]).toEqual({ a: FINAL });
  });
  it("refuses a gate carrying miss_context or evidence", () => {
    expect(() =>
      buildSnapshot(
        source({ a: { tier: "online", miss_context: "rapids" } }),
        TAG,
      ),
    ).toThrow(/a: holds miss_context/);
    expect(() =>
      buildSnapshot(source({ a: { ...FINAL, evidence: TAG } }), TAG),
    ).toThrow(/a: holds evidence/);
  });
  it("refuses another release", () => {
    expect(() =>
      buildSnapshot(source({ a: FINAL }), "fit-2026-10-22-8f85912-r3"),
    ).toThrow();
  });
});

describe("snapshotDifferences", () => {
  const built = buildSnapshot(source({ a: FINAL, b: ONLINE }), TAG);
  const copy = () => JSON.parse(JSON.stringify(built));
  it("matches", () => expect(snapshotDifferences(copy(), built)).toEqual([]));
  it("names a tampered tier", () => {
    const c = copy();
    c.gates.a.tier = "bounded";
    expect(snapshotDifferences(c, built)).toEqual(["gate a differs in tier"]);
  });
  it("names an extra gate", () => {
    const c = copy();
    c.gates.z = FINAL;
    expect(snapshotDifferences(c, built)).toEqual([
      "gate z is not in the release",
    ]);
  });
  it("names a missing gate", () => {
    const c = copy();
    delete c.gates.b;
    expect(snapshotDifferences(c, built)).toEqual([
      "gate b is missing from the snapshot",
    ]);
  });
});
