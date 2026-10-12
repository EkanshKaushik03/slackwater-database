import { describe, expect, test } from "vitest";
import type { StationQuality } from "@slackwater/database";
import { planMerges } from "../merges.ts";
import type { ResolvedStation } from "../metadata.ts";

const NOAA = "US National Oceanic and Atmospheric Administration";
const station = (
  id: string,
  latitude: number,
  m2: number,
  name = "Bermuda",
): ResolvedStation =>
  ({
    id,
    name,
    latitude,
    longitude: -64.7,
    type: "reference",
    source: { name: id.startsWith("noaa/") ? NOAA : "TICON-4" },
    harmonic_constituents: [{ name: "M2", amplitude: m2, phase: 0 }],
  }) as ResolvedStation;
const accepted = (id: string, score = 50): StationQuality =>
  ({ id, accepted: true, score }) as StationQuality;
const duplicate = (id: string, redundant: string): StationQuality =>
  ({
    id,
    accepted: false,
    score: 0,
    reason: "duplicate",
    redundant,
  }) as StationQuality;

// St George's and Ferry Reach are two NOAA gauges 0.75 km apart. Quality pairs
// the Ferry Reach relay with St George's; its own id names Ferry Reach.
const stations = [
  station("noaa/2695540", 32.3734, 0.367),
  station("noaa/2695535", 32.3666, 0.355),
  station("ticon/bermuda-259-gbr-uhslc_fd", 32.3735, 0.366),
  station("ticon/ferry_reach-2695535-usa-noaa", 32.3734, 0.365),
];
const routes = {
  tide: [
    { slug: "st-georges-island", station_ids: ["noaa/2695540"] },
    { slug: "ferry-reach", station_ids: ["noaa/2695535"] },
    { slug: "bermuda", station_ids: ["ticon/bermuda-259-gbr-uhslc_fd"] },
    {
      slug: "ferry-reach-ticon",
      station_ids: ["ticon/ferry_reach-2695535-usa-noaa"],
    },
  ],
  current: [],
};
const quality = new Map(
  [
    accepted("noaa/2695540"),
    accepted("noaa/2695535"),
    duplicate("ticon/bermuda-259-gbr-uhslc_fd", "noaa/2695540"),
    duplicate("ticon/ferry_reach-2695535-usa-noaa", "noaa/2695540"),
  ].map((q) => [q.id, q]),
);

describe("planMerges", () => {
  const plan = planMerges(stations, routes, quality);

  test("keeps the shortest published slug with the authoritative primary", () => {
    const group = plan.groups.find(({ primary }) => primary === "noaa/2695540");
    expect(group?.survivor).toBe("bermuda");
    expect(group?.slugs).toEqual(["bermuda", "st-georges-island"]);
  });

  test("a declared originator outranks an inferred duplicate", () => {
    const group = plan.groups.find(({ primary }) => primary === "noaa/2695535");
    expect(group?.slugs).toEqual(["ferry-reach", "ferry-reach-ticon"]);
    expect(
      group?.members.find(({ id }) => id.includes("ferry_reach"))?.evidence,
    ).toBe("provenance");
  });

  test("refuses a declared originator whose M2 disagrees", () => {
    const far = [...stations];
    far[3] = station("ticon/ferry_reach-2695535-usa-noaa", 32.3734, 0.2);
    const refused = planMerges(far, routes, quality).refused;
    expect(refused).toEqual([
      {
        id: "ticon/ferry_reach-2695535-usa-noaa",
        target: "noaa/2695535",
        reason: "M2 amplitudes differ",
      },
    ]);
  });

  test("leaves a group with two accepted authoritative records unmerged", () => {
    // One route holding both relays would join St George's and Ferry Reach.
    const shared = {
      tide: [
        routes.tide[0]!,
        routes.tide[1]!,
        {
          slug: "bermuda",
          station_ids: [
            "ticon/bermuda-259-gbr-uhslc_fd",
            "ticon/ferry_reach-2695535-usa-noaa",
          ],
        },
      ],
      current: [],
    };
    const plan = planMerges(stations, shared, quality);
    expect(plan.groups).toEqual([]);
    expect(
      plan.conflicts.map(({ authoritative }) => authoritative.sort()),
    ).toEqual([["noaa/2695535", "noaa/2695540"]]);
  });
});
