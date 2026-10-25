import {
  getSourceSuffix,
  roundConstituents,
  type PartialStationData,
} from "@slackwater/stations";
import { parseGeslaSamples, type Sample } from "@slackwater/datums";
import { parseGeslaSamplesInZone } from "@slackwater/harmonic-analysis";

type Constituents = PartialStationData["harmonic_constituents"];

// WSV labels German legal time as UTC. RWS subtracts a fixed CET hour rather
// than a DST-aware offset: winter is UTC already, summer remains one hour fast.
// The historical RWS source is already UTC. See #96 and #98.
export const LOCAL_TIME_SOURCES: Record<
  string,
  { zone: string; shiftHours?: number }
> = {
  wsv: { zone: "Europe/Berlin" },
  rws: { zone: "Europe/Amsterdam", shiftHours: 1 },
};

// UHSLC stamps its Hong Kong hourly heights one hour early: the height it
// labels T was measured at T + 1 h UTC. Each gauge's value is the hours to add.
// See #360.
export const EARLY_GAUGES: Record<string, number> = {
  "hong_kong-329-hkg-uhslc_fd": 1,
  "hong_kong-329a-hkg-uhslc_rq": 1,
  "hong_kong-329b-hkg-uhslc_rq": 1,
};

/** Whether a station's GESLA-4 times, and so TICON's phases, are not UTC. */
export function hasMislabeledClock(id: string): boolean {
  return getSourceSuffix(id) in LOCAL_TIME_SOURCES || id in EARLY_GAUGES;
}

export function parseTiconSamples(id: string, text: string): Sample[] {
  const source = LOCAL_TIME_SOURCES[getSourceSuffix(id)];
  if (!source) return shiftEarlyGauge(id, parseGeslaSamples(text));
  return parseGeslaSamplesInZone(text, source.zone).map((p) => ({
    time: new Date(p.t + (source.shiftHours ?? 0) * 3600000),
    level: p.level,
  }));
}

/** Move an early gauge's samples to the UTC time they were measured. */
export function shiftEarlyGauge(id: string, samples: Sample[]): Sample[] {
  if (!EARLY_GAUGES[id]) return samples;
  return samples.map((s) => ({
    time: measuredAt(id, s.time),
    level: s.level,
  }));
}

/** The UTC time a gauge's height stamped `time` was measured. */
function measuredAt(id: string, time: Date): Date {
  return new Date(time.getTime() + (EARLY_GAUGES[id] ?? 0) * 3600000);
}

/**
 * Whether the live UHSLC RQD record, ending at `rqEnd` as UHSLC stamps it,
 * runs past the station's GESLA-4 samples, which parseTiconSamples has already
 * moved to UTC. Both ends are compared in UTC.
 */
export function extendsGeslaRecord(
  id: string,
  rqEnd: Date,
  samples: Sample[],
): boolean {
  const geslaEnd = samples.reduce(
    (end, s) => Math.max(end, s.time.getTime()),
    -Infinity,
  );
  return measuredAt(id, rqEnd).getTime() > geslaEnd;
}

/**
 * A saved re-fit to reuse, or undefined when there is none: no constituents,
 * or the constituents TICON published, which a file saved before its station
 * was re-fit still holds. Stored constituents are at the published precision,
 * so the published ones are compared at that precision too.
 */
export function cachedRefit(
  stored: Constituents | undefined,
  published: Constituents,
): Constituents | undefined {
  if (!stored?.length) return undefined;
  if (sameConstituents(stored, roundConstituents("ticon", published)))
    return undefined;
  return stored;
}

export function sameConstituents(a: Constituents, b: Constituents) {
  return (
    a.length === b.length &&
    a.every(
      (h, i) =>
        h.name === b[i]!.name &&
        h.amplitude === b[i]!.amplitude &&
        h.phase === b[i]!.phase,
    )
  );
}
