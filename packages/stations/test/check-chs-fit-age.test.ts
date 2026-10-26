import { describe, expect, it } from "vitest";
import {
  ageWarnings,
  newestTags,
  stampWarnings,
} from "../check-chs-fit-age.ts";

const fit = (evidence: string) => ({
  chs_fit: { tier: "online" as const, evidence },
});
const now = new Date("2026-10-26T00:00:00Z");

describe("newestTags", () => {
  it("takes the latest date, then the highest run, per stamp", () => {
    expect(
      newestTags([
        fit("fit-2026-10-22-8f85912-r9"),
        fit("fit-2026-10-22-8f85912-r10"),
        fit("fit-2026-10-23-8f85912-r1"),
        fit("fit-2026-10-20-2222222-r4"),
        {},
      ]),
    ).toEqual(["fit-2026-10-20-2222222-r4", "fit-2026-10-23-8f85912-r1"]);
  });
  it("is empty with no chs_fit", () => {
    expect(newestTags([{}])).toEqual([]);
  });
  it("warns, naming the stamps, when the files cite several", () => {
    expect(stampWarnings(["a", "b"])[0]).toContain("a, b");
    expect(stampWarnings(["a"])).toEqual([]);
  });
});

describe("ageWarnings", () => {
  const tag = "fit-2026-10-22-8f85912-r2";
  it("is quiet when current and recent", () => {
    expect(ageWarnings(tag, "2026-10-25T00:00:00Z", tag, now)).toEqual([]);
  });
  it("warns past 45 days", () => {
    const [w] = ageWarnings(tag, "2026-08-01T00:00:00Z", tag, now);
    expect(w).toMatch(/^::warning::.*\b86 days ago/);
  });
  it("names both tags when a newer release exists", () => {
    const [w] = ageWarnings(
      tag,
      "2026-10-25T00:00:00Z",
      "fit-2026-10-24-8f85912-r3",
      now,
    );
    expect(w).toContain(tag);
    expect(w).toContain("fit-2026-10-24-8f85912-r3");
  });
  it("warns on a missing or unparseable published_at", () => {
    expect(ageWarnings(tag, undefined, tag, now)).toHaveLength(1);
    expect(ageWarnings(tag, "nonsense", tag, now)).toHaveLength(1);
  });
  it("is quiet when latest is older or not a fit tag", () => {
    expect(
      ageWarnings(
        tag,
        "2026-10-25T00:00:00Z",
        "fit-2026-10-01-8f85912-r1",
        now,
      ),
    ).toEqual([]);
    expect(ageWarnings(tag, "2026-10-25T00:00:00Z", "v1.2.3", now)).toEqual([]);
  });
  it("still warns about a stale cited release when the latest lookup failed", () => {
    const warnings = ageWarnings(tag, "2026-08-01T00:00:00Z", null, now);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("days ago");
    const both = ageWarnings(
      tag,
      "2026-08-01T00:00:00Z",
      "fit-2026-10-24-8f85912-r3",
      now,
    );
    expect(both).toHaveLength(2);
  });
  it("ignores a newer latest tag of another stamp", () => {
    expect(
      ageWarnings(
        tag,
        "2026-10-25T00:00:00Z",
        "fit-2026-10-25-abcdef0-r9",
        now,
      ),
    ).toEqual([]);
  });
});
