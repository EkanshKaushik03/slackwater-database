import type { Sample } from "@slackwater/harmonic-analysis";

export const API = "https://opendataapi.dmi.dk/v2/oceanObs";
export const SOURCE = "Danish Meteorological Institute";
export const TERMS = "https://www.dmi.dk/friedata/dokumentation/terms-of-use";
export const CADENCE = 600_000;

export type DmiStation = {
  id: string;
  name: string;
  country: "DNK" | "GRL" | "FRO";
  latitude: number;
  longitude: number;
  lat: number;
  mlws: number;
};
export type Provenance = {
  id: string;
  latitude: number;
  longitude: number;
  url: string;
  observations: string;
  note: string;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected an object");
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Invalid ${name}`);
  return value;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error("Expected a finite number");
  return value;
}

function position(value: unknown): [number, number] {
  const geometry = record(value);
  const coordinates = geometry["coordinates"];
  if (
    geometry["type"] !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2
  )
    throw new Error("Invalid position");
  const lon = finite(coordinates[0]),
    lat = finite(coordinates[1]);
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90)
    throw new Error("Invalid position");
  return [lon, lat];
}

export function parseInventory(value: unknown): DmiStation[] {
  const root = record(value),
    features = root["features"];
  if (
    root["type"] !== "FeatureCollection" ||
    !Array.isArray(features) ||
    root["numberReturned"] !== features.length
  )
    throw new Error("Invalid station collection");
  const ids = new Set<string>();
  return features.map((value) => {
    const feature = record(value),
      p = record(feature["properties"]);
    const id = text(p["stationId"], "station id");
    if (!/^\d+$/.test(id)) throw new Error("Invalid station id");
    if (ids.has(id)) throw new Error(`Duplicate station ${id}`);
    ids.add(id);
    const country = p["country"];
    if (country !== "DNK" && country !== "GRL" && country !== "FRO")
      throw new Error(`Unsupported country ${String(country)}`);
    const [longitude, latitude] = position(feature["geometry"]);
    return {
      id,
      name: text(p["name"], "station name"),
      country,
      latitude,
      longitude,
      lat: Number((finite(p["lowAstronomicalTide"]) / 100).toFixed(3)),
      mlws: Number((finite(p["meanLowWaterSpring"]) / 100).toFixed(3)),
    };
  });
}

export function parsePrediction(
  value: unknown,
  stations: Map<string, DmiStation>,
): (Sample & { id: string }) | null {
  const feature = record(value),
    p = record(feature["properties"]);
  const type = p["predictionType"];
  if (type === "minimum" || type === "maximum") return null;
  if (type !== "10minutes")
    throw new Error(`Unexpected prediction type ${String(type)}`);
  const id = text(p["stationId"], "station id"),
    station = stations.get(id);
  if (!station) throw new Error(`Unknown prediction station ${id}`);
  const [lon, lat] = position(feature["geometry"]);
  if (
    Math.abs(station.latitude - lat) > 1e-6 ||
    Math.abs(station.longitude - lon) > 1e-6
  )
    throw new Error(`${id}: prediction position differs from inventory`);
  const timestamp = text(p["predictionTime"], "prediction time");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp))
    throw new Error(`${id}: prediction time needs an explicit offset`);
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t) || t % CADENCE !== 0)
    throw new Error(`${id}: invalid ten-minute prediction time`);
  return { id, t, level: Number((finite(p["value"]) / 100).toFixed(3)) };
}

export function seriesSamples(
  values: Float64Array,
  start: number,
  from: number,
  to: number,
): Sample[] {
  if (from < 0 || to > values.length || from >= to)
    throw new Error("Invalid sample range");
  return Array.from({ length: to - from }, (_, i) => {
    const index = from + i,
      level = values[index]!;
    if (!Number.isFinite(level))
      throw new Error(
        `Missing prediction at ${new Date(start + index * CADENCE).toISOString()}`,
      );
    return { t: start + index * CADENCE, level };
  });
}

export function matchProvenance(station: DmiStation, entries: Provenance[]) {
  const matches = entries
    .filter(
      (p) =>
        p.id === station.id &&
        Math.abs(p.latitude - station.latitude) < 1e-6 &&
        Math.abs(p.longitude - station.longitude) < 1e-6,
    )
    .sort((a, b) => a.url.localeCompare(b.url));
  if (!matches.length) throw new Error(`${station.id}: no matching provenance`);
  const first = matches[0]!;
  if (
    matches.some(
      (p) => p.observations !== first.observations || p.note !== first.note,
    )
  )
    throw new Error(`${station.id}: conflicting provenance`);
  return {
    ...first,
    origin: /^\d{2}\/\d{4} - \d{2}\/\d{4} : \d+ uniq days/.test(
      first.observations,
    )
      ? "gauge"
      : "unknown",
  };
}
