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
    source: {
      name: id.startsWith("noaa/") ? NOAA : "TICON-4",
      id: id.split("/")[1],
    },
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
            issues: ["Superseded by kartverket/NYA, its operator's own record"],
          },
        ],
      ]),
    );
    expect(plan.groups[0]?.slugs).toEqual(["ny-alesund", "nylesund"]);
    expect(
      plan.groups[0]?.members.find(({ id }) => id.startsWith("ticon/"))
        ?.evidence,
    ).toBe("provenance");
  });

  test("the shortest slug naming the primary wins", () => {
    const records = [
      station("noaa/8575512", 38.98, 0.13, "Annapolis US Naval Academy"),
      station("ticon/annapolis-8575512-usa-noaa", 38.98, 0.13, "Annapolis"),
    ];
    const plan = planMerges(
      records,
      {
        tide: [
          { slug: "annapolis-us-naval-academy", station_ids: [records[0]!.id] },
          { slug: "annapolis", station_ids: [records[1]!.id] },
        ],
        current: [],
      },
      new Map([[records[0]!.id, accepted(records[0]!.id)]]),
    );
    expect(plan.groups[0]?.slugs).toEqual([
      "annapolis",
      "annapolis-us-naval-academy",
    ]);
  });

  test("a superseded relay pointed past its operator is not provenance", () => {
    // noaa/8735180 lost to its Hydro gauge, so quality points the relay there.
    const records = [
      station("noaa/8735181", 30.25, 0.3, "Dauphin Island Hydro"),
      station("ticon/dauphin_island_al-763-usa-uhslc_fd", 30.25, 0.3),
    ];
    const plan = planMerges(
      records,
      {
        tide: records.map(({ id }) => ({
          slug: id.split("/")[1]!,
          station_ids: [id],
        })),
        current: [],
      },
      new Map<string, StationQuality>([
        ["noaa/8735181", accepted("noaa/8735181")],
        [
          records[1]!.id,
          {
            ...duplicate(records[1]!.id, "noaa/8735181"),
            reason: "superseded",
            issues: ["Superseded by noaa/8735180, its operator's own record"],
          },
        ],
      ]),
      { confident: true },
    );
    expect(plan.groups).toEqual([]);
  });

  test("a member's redirect can be the surviving slug", () => {
    const records = [
      station("noaa/8536110", 38.97, 0.7, "Cape May"),
      station("ticon/cape_may-8536110-usa-noaa", 38.97, 0.7, "Cape May"),
    ];
    const plan = planMerges(
      records,
      {
        tide: [
          {
            slug: "cape-may-ferry-terminal",
            station_ids: [records[0]!.id],
            former_paths: ["/tides/us/nj/cape-may/"],
          },
          { slug: "cape-may-nj-nj", station_ids: [records[1]!.id] },
        ],
        current: [],
      },
      new Map([[records[0]!.id, accepted(records[0]!.id)]]),
    );
    expect(plan.groups[0]?.survivor).toBe("cape-may");
    // The primary's own station file carries the merged station.
    expect(plan.groups[0]?.slugs[0]).toBe("cape-may-ferry-terminal");
  });

  test("records sharing a gauge code whose M2 disagree wait for review", () => {
    const records = [
      station("ticon/fanning-012a-kir-uhslc_rq", 3.9, 0.244, "Fanning"),
      station("ticon/fanning-012b-kir-uhslc_rq", 3.9, 0.125, "Fanning"),
    ];
    const routes = {
      tide: records.map(({ id }) => ({
        slug: id.split("/")[1]!,
        station_ids: [id],
      })),
      current: [],
    };
    const quality = new Map([
      [records[0]!.id, accepted(records[0]!.id)],
      [records[1]!.id, duplicate(records[1]!.id, records[0]!.id)],
    ]);
    expect(
      planMerges(records, routes, quality, { confident: true }).groups,
    ).toEqual([]);
    expect(planMerges(records, routes, quality).groups).toHaveLength(1);
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

  // LINZ's 073 is Tauranga, but a three-digit number has no namespace.
  test("refuses an ambiguous UHSLC originator whose M2 disagrees", () => {
    const far = [
      station("linz/073", -37.65, 0.7),
      station("ticon/tauranga-073a-nzl-uhslc_rq", -37.65, 0.4),
    ];
    const plan = planMerges(
      far,
      {
        tide: [
          { slug: "tauranga", station_ids: ["linz/073"] },
          {
            slug: "tauranga-bay",
            station_ids: ["ticon/tauranga-073a-nzl-uhslc_rq"],
          },
        ],
        current: [],
      },
      new Map([["linz/073", accepted("linz/073")]]),
    );
    expect(plan.refused).toEqual([
      {
        id: "ticon/tauranga-073a-nzl-uhslc_rq",
        target: "linz/073",
        reason: "M2 amplitudes differ",
      },
    ]);
  });

  test("trusts a NOAA number from NOAA despite M2", () => {
    const far = [
      station("noaa/2695535", 32.3666, 0.355),
      station("ticon/bermuda-259b-gbr-uhslc_rq", 32.3666, 0.2),
    ];
    const plan = planMerges(
      far,
      {
        tide: [
          { slug: "ferry-reach", station_ids: ["noaa/2695535"] },
          { slug: "bermuda", station_ids: ["ticon/bermuda-259b-gbr-uhslc_rq"] },
        ],
        current: [],
      },
      new Map([["noaa/2695535", accepted("noaa/2695535")]]),
    );
    expect(plan.refused).toEqual([]);
    expect(plan.groups).toHaveLength(1);
  });

  // TICON's Wilmington relay reads M2 0.577 m against NOAA's 0.651 m: the
  // same gauge over different years.
  test("trusts an originator named in the relay's own id despite M2", () => {
    const far = [...stations];
    far[3] = station("ticon/ferry_reach-2695535-usa-noaa", 32.3734, 0.2);
    const plan = planMerges(far, routes, quality);
    expect(plan.refused.map(({ reason }) => reason)).not.toContain(
      "M2 amplitudes differ",
    );
    expect(
      plan.groups.find(({ primary }) => primary === "noaa/2695535")?.slugs,
    ).toEqual(["ferry-reach", "ferry-reach-ticon"]);
    // Farther off, the id may name a renumbered gauge, so M2 decides.
    far[3] = station("ticon/ferry_reach-2695535-usa-noaa", 32.3966, 0.2);
    expect(planMerges(far, routes, quality).refused).toContainEqual({
      id: "ticon/ferry_reach-2695535-usa-noaa",
      target: "noaa/2695535",
      reason: "M2 amplitudes differ",
    });
  });

  test("records sharing a gauge code join each other past an outlier", () => {
    const records = [
      station("ticon/st_helena-292-shn-uhslc_fd", -15.97, 0.3),
      station("ticon/st_helena-292a-shn-uhslc_rq", -15.92, 0.3),
      station("ticon/st_helena-292b-shn-uhslc_rq", -15.92, 0.3),
    ];
    const plan = planMerges(
      records,
      {
        tide: records.map(({ id }) => ({
          slug: id.split("/")[1]!,
          station_ids: [id],
        })),
        current: [],
      },
      new Map(records.map(({ id }) => [id, accepted(id)])),
      { confident: true },
    );
    expect(
      plan.groups.map(({ members }) => members.map(({ id }) => id)),
    ).toEqual([[records[1]!.id, records[2]!.id]]);
  });

  test("a gauge link outranks a proximity link to another authority", () => {
    const records = [
      station("noaa/1000001", 32.0, 0.3),
      station("noaa/1000002", 32.03, 0.3),
      station("ticon/x-100-usa-uhslc_fd", 32.0, 0.3),
      station("ticon/x-100a-usa-uhslc_rq", 32.03, 0.3),
    ];
    const plan = planMerges(
      records,
      {
        tide: [
          { slug: "a", station_ids: ["noaa/1000001"] },
          { slug: "b", station_ids: ["noaa/1000002", records[3]!.id] },
          { slug: "x", station_ids: [records[2]!.id] },
        ],
        current: [],
      },
      // The proximity link comes first; the gauge link must still win.
      new Map([
        [records[2]!.id, duplicate(records[2]!.id, "noaa/1000001")],
        [records[3]!.id, duplicate(records[3]!.id, records[2]!.id)],
      ]),
    );
    expect(plan.refused.map(({ id }) => id)).toEqual([records[2]!.id]);
  });

  test("refuses a link that would join two authoritative records", () => {
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
    expect(plan.groups.map(({ slugs }) => slugs)).toEqual([
      ["bermuda", "ferry-reach"],
    ]);
    expect(plan.refused).toEqual([
      {
        id: "ticon/bermuda-259-gbr-uhslc_fd",
        target: "noaa/2695540",
        reason: "would join noaa/2695535 and noaa/2695540",
      },
    ]);
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
    expect(plan.refused).toHaveLength(1);
  });

  test("a confident plan leaves proximity and far-flung gauge codes for review", () => {
    const records = [
      station("ticon/port_stanley-290-gbr-uhslc_fd", -51.75, 0.5, "Stanley"),
      // A gauge code shared 105 km away is a bad position, not a move.
      station("ticon/port_stanley-290a-gbr-uhslc_rq", -50.8, 0.5, "Stanley"),
      station("ticon/port_stanley-290b-gbr-uhslc_rq", -51.751, 0.5, "Stanley"),
      station("ticon/stanley-stan-gbr-cmems", -51.752, 0.5, "Stanley"),
    ];
    const routes = {
      tide: records.map(({ id }) => ({
        slug: id.split("/")[1]!,
        station_ids: [id],
      })),
      current: [],
    };
    const quality = new Map([
      [records[0]!.id, accepted(records[0]!.id)],
      ...records
        .slice(1)
        .map(({ id }) => [id, duplicate(id, records[0]!.id)] as const),
    ]);
    const slugs = (confident: boolean) =>
      planMerges(records, routes, quality, { confident }).groups.map(
        ({ members }) => members.map(({ id }) => id).sort(),
      );
    expect(slugs(true)).toEqual([[records[0]!.id, records[2]!.id]]);
    expect(slugs(false)[0]).toHaveLength(4);
    const evidence = planMerges(records, routes, quality).groups[0]!.members;
    expect(evidence.find(({ id }) => id.includes("cmems"))?.evidence).toBe(
      "proximity",
    );
    expect(evidence.find(({ id }) => id.includes("290b"))?.evidence).toBe(
      "gauge",
    );
  });
});
