import { describe, expect, test } from "vitest";
import { buildCatalogue, type CatalogueInputs } from "../catalogue.ts";
import type { StationFile } from "../station-files.ts";

const geocoder = { nearest: () => null, near: () => [] };

const station = (
  kind: "tide" | "current",
  country: string,
  slug: string,
  sources: string[],
  extra: Partial<StationFile> = {},
): StationFile => ({
  kind,
  country,
  slug,
  file: `stations/${kind}/${country.toLowerCase()}/${slug}.yaml`,
  sources,
  ...extra,
});

function fixtures(): CatalogueInputs {
  return {
    tides: [
      {
        id: "noaa/9447130",
        name: "SEATTLE",
        latitude: 47.6026,
        longitude: -122.3393,
        timezone: "America/Los_Angeles",
        country: "United States",
        country_code: "US",
        type: "reference",
        harmonic_constituents: [],
      },
    ],
    currents: [
      {
        id: "noaa/PUG1701",
        kind: "current",
        name: "Deception Pass",
        latitude: 48.4,
        longitude: -122.65,
        timezone: "America/Los_Angeles",
        country: "United States",
        country_code: "US",
        type: "reference",
        harmonic_constituents: [],
        current: {
          flood_direction: 90,
          ebb_direction: 270,
          mean_flow: 0,
        },
      },
    ],
    corrections: new Map(),
    registry: new Map([
      [
        "chs-point-atkinson",
        {
          name: "Point Atkinson",
          provider: "chs",
          kind: "tide",
          position: [49.337, -123.254],
          location: {
            region: "British Columbia",
            regionCode: "CA-BC",
            country: "Canada",
            countryCode: "CA",
          },
        },
      ],
      [
        "chs-malibu-rapids",
        {
          name: "Malibu Rapids",
          provider: "chs",
          kind: "current",
          position: [50.1626, -123.8515],
          location: {
            region: "British Columbia",
            regionCode: "CA-BC",
            country: "Canada",
            countryCode: "CA",
          },
          derived: {
            reference: "chs-point-atkinson",
            hwLagMinutes: 25,
            lwLagMinutes: 35,
          },
        },
      ],
    ]),
    stationFiles: [
      station("tide", "US", "seattle", ["noaa/9447130"]),
      station("tide", "CA", "point-atkinson", ["chs-point-atkinson"], {
        region: "CA-BC",
      }),
      station("current", "US", "deception-pass", ["noaa/PUG1701"]),
      station("current", "CA", "malibu-rapids", ["chs-malibu-rapids"], {
        region: "CA-BC",
      }),
    ],
    geocoder,
  };
}

describe("buildCatalogue", () => {
  describe("curating opaque TICON names", () => {
    function inputWithName(name: string): CatalogueInputs {
      const input = fixtures();
      input.tides[0] = { ...input.tides[0]!, id: "ticon/s197", name: "S197_T" };
      input.stationFiles[0]!.sources = ["ticon/s197"];
      input.corrections.set("ticon/s197", { name });
      const place = {
        place: {
          name: "Seattle",
          countryCode: "US",
          admin1: "Washington",
          admin1Code: "WA",
          population: 750000,
          latitude: 47.6,
          longitude: -122.3,
        },
        distance: 2,
        country: "United States",
        continent: "North America",
        region: "WA",
      };
      input.geocoder = { nearest: () => place, near: () => [place] };
      return input;
    }

    test("accepts a curation of the geocoded place name", () => {
      const catalogue = buildCatalogue(inputWithName("Seattle Gauge"));
      expect(
        catalogue.stations.find(({ id }) => id === "ticon/s197")?.name,
      ).toBe("Seattle Gauge");
    });

    test("rejects a curation of a different place", () => {
      expect(() => buildCatalogue(inputWithName("Everett Gauge"))).toThrow(
        /shares no meaningful word/,
      );
    });

    test("validates the name at a corrected position without bypassing the distance limit", () => {
      const input = inputWithName("Everett Gauge");
      const station = input.tides[0]!;
      const original = input.geocoder.nearest(
        station.latitude!,
        station.longitude!,
      )!;
      input.geocoder = {
        nearest: (lat) =>
          lat > 47.61
            ? { ...original, place: { ...original.place, name: "Everett" } }
            : original,
        near: (lat, lon) => [input.geocoder.nearest(lat, lon)!],
      };
      input.corrections.get("ticon/s197")!.position = [47.62, -122.3393];
      expect(
        buildCatalogue(input).stations.find(({ id }) => id === "ticon/s197")
          ?.name,
      ).toBe("Everett Gauge");

      input.corrections.get("ticon/s197")!.position = [48.62, -122.3393];
      expect(() => buildCatalogue(input)).toThrow(/corrected position/);
    });
  });

  test("records in one station share its route and keep its redirects", () => {
    const input = fixtures();
    input.tides[0]!.harmonic_constituents = [
      { name: "M2", amplitude: 1, phase: 10 },
    ];
    input.tides.push({
      ...input.tides[0]!,
      id: "ticon/seattle",
      harmonic_constituents: [{ name: "M2", amplitude: 2, phase: 20 }],
    });
    input.stationFiles[0] = station("tide", "US", "seattle", [
      "noaa/9447130",
      "ticon/seattle",
    ]);
    input.stationFiles[0].redirect_from = ["/tides/us/seattle-relay/"];

    const catalogue = buildCatalogue(input);
    expect(catalogue.routes.tide.find((r) => r.slug === "seattle")).toEqual({
      slug: "seattle",
      station_ids: ["noaa/9447130", "ticon/seattle"],
      former_paths: ["/tides/us/seattle-relay/"],
    });
    for (const record of input.tides)
      expect(
        catalogue.stations.find((s) => s.id === record.id)
          ?.harmonic_constituents,
      ).toEqual(record.harmonic_constituents);
  });

  test("a record no station lists gets a slug no station or redirect holds", () => {
    const input = fixtures();
    input.tides.push({ ...input.tides[0]!, id: "ticon/seattle" });
    input.stationFiles.push(
      station("tide", "US", "elliott-bay", [], {
        redirect_from: ["/tides/us/seattle-noaa-9447130/"],
      }),
    );
    const catalogue = buildCatalogue(input);
    const slugOf = (id: string) =>
      catalogue.routes.tide.find(({ station_ids }) => station_ids.includes(id))
        ?.slug;
    expect(slugOf("noaa/9447130")).toBe("seattle");
    expect(slugOf("ticon/seattle")).toBe("seattle-ticon-seattle");
  });

  test("combines provider and registry stations with stable routes", () => {
    const catalogue = buildCatalogue(fixtures());

    expect(catalogue.stations.map((station) => station.id)).toEqual([
      "chs-malibu-rapids",
      "chs-point-atkinson",
      "noaa/9447130",
      "noaa/PUG1701",
    ]);
    expect(
      catalogue.routes.tide.find(({ slug }) => slug === "seattle"),
    ).toMatchObject({ station_ids: ["noaa/9447130"] });
    expect(
      catalogue.routes.current.find(({ slug }) => slug === "malibu-rapids"),
    ).toMatchObject({ station_ids: ["chs-malibu-rapids"] });
    expect(
      catalogue.stations.find(({ id }) => id === "chs-malibu-rapids")?.current
        ?.derived,
    ).toEqual({
      reference: "chs-point-atkinson",
      high_water_lag_minutes: 25,
      low_water_lag_minutes: 35,
    });
    expect(
      catalogue.stations.every(
        ({ country, country_code }) => country && country_code,
      ),
    ).toBe(true);
    expect(
      catalogue.stations.find(({ id }) => id === "chs-point-atkinson")?.source,
    ).toMatchObject({
      name: "Canadian Hydrographic Service",
      id: "chs-point-atkinson",
      published_harmonics: false,
    });
  });

  test("a provider current's curated tide pairing publishes as its station's first record", () => {
    const input = fixtures();
    input.tides.push({
      ...input.tides[0]!,
      id: "ticon/seattle",
      quality: { id: "ticon/seattle", accepted: false, score: 0 },
    });
    input.stationFiles[0] = station("tide", "US", "seattle", [
      "noaa/9447130",
      "ticon/seattle",
    ]);
    // Curated against the relay, which quality now rejects for its operator's
    // record of the same gauge.
    input.corrections.set("noaa/PUG1701", { tideReference: "ticon/seattle" });

    const catalogue = buildCatalogue(input);
    expect(
      catalogue.stations.find(({ id }) => id === "noaa/PUG1701")?.current
        ?.tide_reference,
    ).toBe("noaa/9447130");
  });

  test("refuses a curated tide pairing that names a current", () => {
    const input = fixtures();
    input.currents.push({ ...input.currents[0]!, id: "noaa/PUG1702" });
    input.corrections.set("noaa/PUG1701", { tideReference: "noaa/PUG1702" });

    expect(() => buildCatalogue(input)).toThrow(
      /noaa\/PUG1701 references noaa\/PUG1702, which is not tide/,
    );
  });

  test("rejects a missing station reference with both ids", () => {
    const input = fixtures();
    input.currents[0]!.current!.offsets = { reference: "noaa/missing" };

    expect(() => buildCatalogue(input)).toThrow(/noaa\/PUG1701.*noaa\/missing/);
  });

  test("keeps rejected station URLs but omits explicit support records", () => {
    const input = fixtures();
    input.tides[0]!.quality = {
      id: "noaa/9447130",
      accepted: false,
      score: 0,
    };
    input.currents[0]!.routed = false;

    const catalogue = buildCatalogue(input);
    expect(catalogue.routes.tide.map(({ slug }) => slug)).toContain("seattle");
    expect(catalogue.routes.current).toEqual([
      expect.objectContaining({ slug: "malibu-rapids" }),
    ]);
  });

  test("a retired record the provider publishes again rejoins its station", () => {
    const input = fixtures();
    input.stationFiles[0] = station("tide", "US", "seattle", [], {
      retired_sources: ["noaa/9447130"],
    });
    const catalogue = buildCatalogue(input);
    expect(
      catalogue.routes.tide.find(({ station_ids }) =>
        station_ids.includes("noaa/9447130"),
      )?.slug,
    ).toBe("seattle");
  });
});
