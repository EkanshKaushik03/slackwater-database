import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checkConstituents,
  checkSeasonalDominance,
  hasSimilarM2,
  loadAllStations,
  RECENCY_YEAR,
  scoreAmplitude,
  scoreRecency,
  tideConflict,
} from "../evaluate-quality.ts";
import { exceeds, seasonalTerms } from "../filtering.ts";

type Station = Parameters<typeof checkConstituents>[0];
type Constituent = { amplitude: number; phase?: number };

function station(
  constituents: Record<string, number | Constituent>,
  id = "ticon/test",
): Station {
  return {
    id,
    type: "reference",
    harmonic_constituents: Object.entries(constituents).map(([name, c]) =>
      typeof c === "number"
        ? { name, amplitude: c, phase: 10 }
        : { name, amplitude: c.amplitude, phase: c.phase ?? 10 },
    ),
  } as unknown as Station;
}

const BASE = { M2: 0.5, S2: 0.2, K1: 0.1, O1: 0.07 };

describe("exceeds", () => {
  test("needs more than the 3 mm fit tolerance", () => {
    expect(exceeds(0.005, 0.002)).toBe(false);
    expect(exceeds(0.0051, 0.002)).toBe(true);
  });
});

describe("seasonalTerms", () => {
  test("puts SA_KV on SA's clock by adding the longitude of perihelion", () => {
    const { annual } = seasonalTerms([
      { name: "SA_KV", amplitude: 0.1, phase: 100 },
    ]);
    expect(annual?.phase).toBeCloseTo(23.4);
  });
});

describe("checkConstituents", () => {
  test("rejects a NOAA constituent published as not determined", () => {
    const s2 = { amplitude: 0, phase: 0 };
    expect(checkConstituents(station({ ...BASE, S2: s2 }, "noaa/1"))).toMatch(
      /not determined by the source: S2/,
    );
  });

  test("accepts a zero amplitude that carries a phase", () => {
    const s2 = { amplitude: 0, phase: 12.3 };
    expect(
      checkConstituents(station({ ...BASE, S2: s2 }, "noaa/1")),
    ).toBeNull();
  });

  test("accepts a zero amplitude at phase 0 outside NOAA", () => {
    // A TICON value below detection can round to phase 0 by chance.
    const s2 = { amplitude: 0, phase: 0 };
    expect(checkConstituents(station({ ...BASE, S2: s2 }))).toBeNull();
  });

  test("rejects a resolved P1 well above a small K1", () => {
    // Radiational forcing brings P1 level with a small K1, not to 4 times it.
    expect(
      checkConstituents(station({ ...BASE, K1: 0.003, P1: 0.013 })),
    ).toMatch(/inconsistent with the gravitational tide/);
  });

  test("ignores P1 above K1 while P1 is too small to be resolved", () => {
    expect(
      checkConstituents(station({ ...BASE, K1: 0.005, P1: 0.009 })),
    ).toBeNull();
  });

  test("ignores P1 above K1 inside the fit tolerance", () => {
    expect(
      checkConstituents(station({ ...BASE, K1: 0.02, P1: 0.023 })),
    ).toBeNull();
  });

  test("rejects P1 above a resolved K1 beyond the fit tolerance", () => {
    expect(
      checkConstituents(station({ ...BASE, K1: 0.02, P1: 0.024 })),
    ).toMatch(/inconsistent with the gravitational tide/);
  });
});

describe("scoreAmplitude", () => {
  test("ignores a child above its parent inside the fit tolerance", () => {
    expect(
      scoreAmplitude(station({ ...BASE, O1: 0.001, Q1: 0.004 })).issues,
    ).toEqual([]);
  });

  test("warns about a child above its parent beyond the fit tolerance", () => {
    expect(
      scoreAmplitude(station({ ...BASE, O1: 0.001, Q1: 0.005 })).issues,
    ).toEqual(["Q1 amplitude (0.0050) exceeds O1 (0.0010)"]);
  });

  test("ignores a parent NOAA did not determine", () => {
    const s2 = { amplitude: 0, phase: 0 };
    expect(
      scoreAmplitude(station({ ...BASE, S2: s2, K2: 0.01 }, "noaa/1")).issues,
    ).toEqual([]);
  });

  test("does not penalise a high form number", () => {
    // A diurnal Louisiana marsh: F is effectively unbounded.
    expect(
      scoreAmplitude(station({ M2: 0, S2: 0, K1: 0.024, O1: 0.023 })).issues,
    ).toEqual([]);
  });

  test("penalises a record with no principal tide at all", () => {
    expect(
      scoreAmplitude(station({ M2: 0, S2: 0, K1: 0, O1: 0 })).issues,
    ).toEqual(["No diurnal or semidiurnal constituents with amplitude > 0"]);
  });
});

describe("checkSeasonalDominance", () => {
  const dominance = (constituents: Record<string, number | Constituent>) =>
    checkSeasonalDominance(station(constituents), new Map());

  // Principal tide M2+S2+K1+O1 = 0.069 m.
  const SMALL = { M2: 0.03, S2: 0.02, K1: 0.01, O1: 0.009 };

  test("compares against the principal tide, not its largest constituent", () => {
    // SA is twice M2 but below the tide's combined daily swing.
    expect(dominance({ ...SMALL, SA: 0.06 })).toBeNull();
  });

  test("does not label a difference inside the fit tolerance", () => {
    expect(dominance({ ...SMALL, SA: 0.072 })).toBeNull();
  });

  test("labels a seasonal band beyond the fit tolerance", () => {
    expect(dominance({ ...SMALL, SA: 0.0721 })).toMatch(
      /Seasonal curve peak \(0\.072m\) exceeds the principal tide M2\+S2\+K1\+O1 \(0\.069m\)/,
    );
  });

  test("measures a subordinate on its reference's constituents", () => {
    const reference = station(
      { M2: 0.002, S2: 0.001, K1: 0.001, O1: 0.001, SA: 0.15 },
      "noaa/ref",
    );
    const subordinate = {
      id: "noaa/sub",
      type: "subordinate",
      harmonic_constituents: [],
      offsets: { reference: "noaa/ref" },
    } as unknown as Station;
    expect(
      checkSeasonalDominance(subordinate, new Map([["noaa/ref", reference]])),
    ).toMatch(/from reference noaa\/ref/);
  });

  test("measures the seasonal curve with its phases", () => {
    // In phase, SA and SSA peak together at 0.08 m, above the 0.069 m tide.
    expect(
      dominance({
        ...SMALL,
        SA: { amplitude: 0.05, phase: 0 },
        SSA: { amplitude: 0.03, phase: 0 },
      }),
    ).toMatch(/Seasonal curve peak \(0\.080m\)/);
    // Out of step, the curve peaks at 0.069 m, level with the tide.
    expect(
      dominance({
        ...SMALL,
        SA: { amplitude: 0.05, phase: 0 },
        SSA: { amplitude: 0.03, phase: 90 },
      }),
    ).toBeNull();
  });

  test("reads the seasonal terms under every source's names", () => {
    // LINZ: Sa and Ssa.
    expect(dominance({ ...SMALL, Sa: 0.08 })).toMatch(/0\.080m/);
    // Kartverket: SA_KV, whose argument is h − p′, with Ssa.
    expect(dominance({ ...SMALL, SA_KV: 0.08 })).toMatch(/0\.080m/);
  });

  test("labels a station with no principal tide", () => {
    expect(dominance({ M2: 0, S2: 0, K1: 0, O1: 0, SA: 0.06 })).toMatch(
      /yearly swing exceeds the daily one/,
    );
  });
});

describe("hasSimilarM2", () => {
  const m2 = (amplitude: number) => station({ M2: amplitude });

  test("treats amplitudes within the fit tolerance as similar", () => {
    expect(hasSimilarM2(m2(0.003), m2(0.005))).toBe(true);
  });

  test("counts exactly 3 mm apart as within the tolerance", () => {
    // 0.012 - 0.009 is 0.003000000000000001 in floating point.
    expect(hasSimilarM2(m2(0.012), m2(0.009))).toBe(true);
  });

  test("takes no evidence from two M2 values inside the tolerance", () => {
    expect(hasSimilarM2(m2(0), m2(0))).toBe(false);
    expect(hasSimilarM2(m2(0.001), m2(0.003))).toBe(false);
  });

  test("uses the ratio once M2 is large", () => {
    expect(hasSimilarM2(m2(0.3), m2(0.32))).toBe(true);
    expect(hasSimilarM2(m2(0.02), m2(0.03))).toBe(false);
  });
});

describe("scoreRecency", () => {
  afterEach(() => vi.useRealTimers());

  test("does not depend on today's date", () => {
    const station = { epoch: { start: "1983-01-01", end: "2001-12-31" } };
    const score = () => scoreRecency(station as never, new Map());
    vi.useFakeTimers({ now: new Date("2026-06-01") });
    const now = score();
    vi.setSystemTime(new Date("2040-06-01"));
    expect(score()).toBe(now);
    expect(now).toBe(1 - (RECENCY_YEAR - 2001) / 100);
  });
});

// CI's filesystem lists files in hash order, a Mac's in name order; quality
// must not depend on which.
test("weighs records in id order whatever the filesystem lists", async () => {
  const ids = (await loadAllStations()).map(({ id }) => id);
  expect(ids).toEqual([...ids].sort());
});

describe("tideConflict", () => {
  test("states a merged record's M2 disagreement as time", () => {
    // Venice: the City of Venice record runs about 46 minutes from ISPRA's.
    const cv = station({ M2: { amplitude: 0.242, phase: 284.3 } });
    const ispra = station({ M2: { amplitude: 0.233, phase: 262.2 } });
    expect(tideConflict(cv, ispra)).toMatch(/runs 46 min later/);
    expect(tideConflict(ispra, cv)).toMatch(/runs 46 min earlier/);
  });

  test("passes a pair within one gauge analyzed twice", () => {
    const a = station({ M2: { amplitude: 0.5, phase: 100 } });
    const b = station({ M2: { amplitude: 0.5, phase: 104 } });
    expect(tideConflict(a, b)).toBeNull();
  });

  test("passes millimeter tides whose phase is noise", () => {
    const a = station({ M2: { amplitude: 0.002, phase: 10 } });
    const b = station({ M2: { amplitude: 0.002, phase: 60 } });
    expect(tideConflict(a, b)).toBeNull();
  });
});
