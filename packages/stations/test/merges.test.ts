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

  test("keeps the published slug that names the authoritative primary", () => {
    const group = plan.groups.find(({ primary }) => primary === "noaa/2695540");
    expect(group?.survivor).toBe("bermuda");
    expect(group?.slugs).toEqual(["bermuda", "st-georges-island"]);
  });

  test("the surviving URL names the primary record, not the shortest slug", () => {
    const named = [
      station("noaa/9461380", 51.86, 0.3, "Sweeper Cove"),
      station("ticon/adak-040-usa-uhslc_fd", 51.86, 0.3, "Adak"),
    ];
    const plan = planMerges(
      named,
      {
        tide: [
          { slug: "sweeper-cove", station_ids: ["noaa/9461380"] },
          { slug: "adak", station_ids: ["ticon/adak-040-usa-uhslc_fd"] },
        ],
        current: [],
      },
      new Map([
        ["noaa/9461380", accepted("noaa/9461380")],
        [
          "ticon/adak-040-usa-uhslc_fd",
          duplicate("ticon/adak-040-usa-uhslc_fd", "noaa/9461380"),
        ],
      ]),
    );
    expect(plan.groups[0]?.slugs).toEqual(["sweeper-cove", "adak"]);
  });

  test("joins a relay superseded by its operator's record", () => {
    // UHSLC's fast-delivery Ny-Ålesund declares nothing itself; quality
    // supersedes it through its research-quality sibling.
    const plan = planMerges(
      [
        station("kartverket/NYA", 78.93, 0.457, "Ny-Ålesund"),
        station("ticon/nylesund-823-nor-uhslc_fd", 78.93, 0.457, "Nylesund"),
      ],
      {
        tide: [
          { slug: "ny-alesund", station_ids: ["kartverket/NYA"] },
          {
            slug: "nylesund",
            station_ids: ["ticon/nylesund-823-nor-uhslc_fd"],
          },
        ],
        current: [],
      },
      new Map<string, StationQuality>([
        ["kartverket/NYA", accepted("kartverket/NYA")],
        [
          "ticon/nylesund-823-nor-uhslc_fd",
          {
            ...duplicate("ticon/nylesund-823-nor-uhslc_fd", "kartverket/NYA"),
            reason: "superseded",
          },
        ],
      ]),
    );
    expect(plan.groups[0]?.slugs).toEqual(["ny-alesund", "nylesund"]);
  });

  test("without its name, the URL is the primary's own slug unless that ends in an id", () => {
    const pair = (primary: string, relay: string) =>
      planMerges(
        [
          station("linz/030", -45.8, 0.8, "Port Chalmers"),
          station(
            "ticon/port_chalmers-669a-nzl-uhslc_rq",
            -45.8,
            0.8,
            "Port Chalmers",
          ),
        ],
        {
          tide: [
            { slug: primary, station_ids: ["linz/030"] },
            {
              slug: relay,
              station_ids: ["ticon/port_chalmers-669a-nzl-uhslc_rq"],
            },
          ],
          current: [],
        },
        new Map([
          ["linz/030", accepted("linz/030")],
          [
            "ticon/port_chalmers-669a-nzl-uhslc_rq",
            duplicate("ticon/port_chalmers-669a-nzl-uhslc_rq", "linz/030"),
          ],
        ]),
      ).groups[0]?.survivor;
    expect(pair("port-chalmers-otago", "port-chalmers-dunedin")).toBe(
      "port-chalmers-otago",
    );
    expect(pair("port-chalmers-linz-030", "port-chalmers-otago")).toBe(
      "port-chalmers-otago",
    );
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

  // Quality rejecting one of two NOAA station numbers as a duplicate does not
  // make them one gauge.
  test("leaves two authoritative records unmerged even when one is rejected", () => {
    const pair = [
      station("noaa/8735180", 30.25, 0.3, "Dauphin Island"),
      station("noaa/8735181", 30.25, 0.3, "Dauphin Island Hydro"),
    ];
    const plan = planMerges(
      pair,
      {
        tide: [
          { slug: "dauphin-island", station_ids: ["noaa/8735180"] },
          { slug: "dauphin-island-hydro", station_ids: ["noaa/8735181"] },
        ],
        current: [],
      },
      new Map([
        ["noaa/8735181", accepted("noaa/8735181")],
        ["noaa/8735180", duplicate("noaa/8735180", "noaa/8735181")],
      ]),
    );
    expect(plan.groups).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
  });
});
