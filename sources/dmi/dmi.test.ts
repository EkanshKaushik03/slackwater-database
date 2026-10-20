import { describe, expect, it } from "vitest";
import {
  parseInventory,
  parsePrediction,
  seriesSamples,
  matchProvenance,
} from "./dmi.ts";

const feature = (id = "2991540", coordinates = [-52.8253, 68.7189]) => ({
  type: "Feature",
  id: "internal-uuid",
  geometry: { type: "Point", coordinates },
  properties: {
    stationId: id,
    name: "Aasiaat",
    country: "GRL",
    lowAstronomicalTide: -143.5,
    meanLowWaterSpring: -84.1,
    created: "2026-03-13T14:52:57Z",
  },
});
const inventory = (...features: unknown[]) => ({
  type: "FeatureCollection",
  features,
  numberReturned: features.length,
  links: [],
});
const stations = () => parseInventory(inventory(feature()));
const prediction = (
  time: string,
  value: number,
  predictionType = "10minutes",
) => ({
  ...feature(),
  properties: {
    stationId: "2991540",
    predictionTime: time,
    predictionType,
    value,
    created: "2026-03-23T10:20:13Z",
  },
});

describe("DMI source contract", () => {
  it.each([
    {
      id: "25149",
      country: "DNK",
      name: "Esbjerg",
      coordinates: [8.4397, 55.4602],
      wall: "2027-01-01T00:00:00+01:00",
      utc: "2026-12-31T23:00:00Z",
      cm: -17.8,
      metres: -0.178,
    },
    {
      id: "2991540",
      country: "GRL",
      name: "Aasiaat",
      coordinates: [-52.8253, 68.7189],
      wall: "2027-01-01T00:00:00-02:00",
      utc: "2027-01-01T02:00:00Z",
      cm: -70.5,
      metres: -0.705,
    },
    {
      id: "2988270",
      country: "FRO",
      name: "Torshavn",
      coordinates: [-6.769, 62.008],
      wall: "2027-01-01T00:00:00Z",
      utc: "2027-01-01T00:00:00Z",
      cm: 4.4,
      metres: 0.044,
    },
  ])(
    "matches independently checked DMI ZERO values at $name",
    ({ id, country, name, coordinates, wall, utc, cm, metres }) => {
      // Values checked against https://ocean.dmi.dk/tides/ZERO/2027/<name>.tmp.txt and the API at the same instant.
      const f = feature(id, coordinates);
      Object.assign(f.properties, { country, name });
      const map = new Map(parseInventory(inventory(f)).map((s) => [s.id, s]));
      const p = {
        ...f,
        properties: {
          stationId: id,
          predictionType: "10minutes",
          predictionTime: wall,
          value: cm,
        },
      };
      expect(parsePrediction(p, map)).toEqual({
        id,
        t: Date.parse(utc),
        level: metres,
      });
    },
  );
  it("uses prediction station IDs, preserves source datum precision and converts cm to m", () => {
    expect(stations()[0]).toEqual({
      id: "2991540",
      name: "Aasiaat",
      country: "GRL",
      latitude: 68.7189,
      longitude: -52.8253,
      lat: -1.435,
      mlws: -0.841,
    });
    expect(
      parsePrediction(
        prediction("2027-01-01T00:00:00-02:00", -70.5),
        new Map(stations().map((s) => [s.id, s])),
      ),
    ).toEqual({
      id: "2991540",
      t: Date.parse("2027-01-01T02:00:00Z"),
      level: -0.705,
    });
  });

  it("rejects duplicate IDs, missing fields, non-finite datums and invalid positions", () => {
    expect(() => parseInventory(inventory(feature(), feature()))).toThrow(
      /duplicate/i,
    );
    expect(() => parseInventory(inventory(feature("../escape")))).toThrow(
      /id/i,
    );
    expect(() =>
      parseInventory(inventory(feature("2991540", [0, 91]))),
    ).toThrow(/position/i);
    const bad = feature();
    bad.properties.lowAstronomicalTide = NaN;
    expect(() => parseInventory(inventory(bad))).toThrow(/finite/i);
    expect(() => parseInventory({ features: null })).toThrow();
    const country = feature();
    country.properties.country = "XYZ";
    expect(() => parseInventory(inventory(country))).toThrow(/country/i);
  });

  it("ignores extrema but rejects unknown prediction types, wrong identities and implicit zones", () => {
    const map = new Map(stations().map((s) => [s.id, s]));
    expect(
      parsePrediction(prediction("2027-01-01T02:00:00Z", 0, "minimum"), map),
    ).toBeNull();
    expect(() =>
      parsePrediction(prediction("2027-01-01T02:00:00Z", 0, "unknown"), map),
    ).toThrow(/type/i);
    expect(() =>
      parsePrediction(prediction("2027-01-01T02:00:00", 0), map),
    ).toThrow(/offset/i);
    expect(() =>
      parsePrediction(prediction("2027-01-01T02:00:00Z", NaN), map),
    ).toThrow(/finite/i);
    const wrong = prediction("2027-01-01T02:00:00Z", 0);
    wrong.geometry.coordinates = [0, 0];
    expect(() => parsePrediction(wrong, map)).toThrow(/position/i);
    wrong.properties.stationId = "999";
    expect(() => parsePrediction(wrong, map)).toThrow(/station/i);
  });

  it("requires complete ten-minute coverage, including valid zero heights", () => {
    const start = Date.parse("2026-12-31T23:50Z");
    expect(
      seriesSamples(new Float64Array([0, 0.1, -0.1]), start, 0, 3),
    ).toEqual([
      { t: start, level: 0 },
      { t: start + 600000, level: 0.1 },
      { t: start + 1200000, level: -0.1 },
    ]);
    expect(() =>
      seriesSamples(new Float64Array([0, NaN]), start, 0, 2),
    ).toThrow(/missing/i);
  });

  it("joins provenance on ID and position, collapses identical aliases and preserves caveats", () => {
    const station = stations()[0]!;
    const p = {
      id: station.id,
      latitude: station.latitude,
      longitude: station.longitude,
      url: "https://example.test/Aasiaat.txt",
      observations: "06/1997 - 12/2001 : 1284 uniq days",
      note: "dry out at low waters",
    };
    expect(
      matchProvenance(station, [
        p,
        { ...p, url: "https://example.test/alias.txt" },
      ]),
    ).toMatchObject({ origin: "gauge", note: "dry out at low waters" });
    expect(
      matchProvenance(station, [{ ...p, observations: "Unknown" }]),
    ).toMatchObject({ origin: "unknown" });
    expect(() => matchProvenance(station, [{ ...p, latitude: 0 }])).toThrow(
      /provenance/i,
    );
    expect(() =>
      matchProvenance(station, [p, { ...p, observations: "different" }]),
    ).toThrow(/conflict/i);
  });
});
