import { describe, expect, it } from "vitest";
import { ageWarnings, newestTag } from "../check-chs-fit-age.ts";

const fit = (evidence: string) => ({
  chs_fit: { tier: "online" as const, evidence },
});
const now = new Date("2026-10-26T00:00:00Z");

describe("newestTag", () => {
  it("takes the latest date, then the highest run", () => {
    expect(
      newestTag([
        fit("fit-2026-10-22-8f85912-r9"),
        fit("fit-2026-10-23-1111111-r2"),
        fit("fit-2026-10-23-2222222-r10"),
        {},
      ]),
    ).toBe("fit-2026-10-23-2222222-r10");
  });
  it("is null with no chs_fit", () => {
    expect(newestTag([{}])).toBeNull();
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
      "fit-2026-10-24-abcdef0-r3",
      now,
    );
    expect(w).toContain(tag);
    expect(w).toContain("fit-2026-10-24-abcdef0-r3");
  });
  it("warns on a missing or unparseable published_at", () => {
    expect(ageWarnings(tag, undefined, tag, now)).toHaveLength(1);
    expect(ageWarnings(tag, "nonsense", tag, now)).toHaveLength(1);
  });
});
