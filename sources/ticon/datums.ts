import type { PartialStationData } from "@slackwater/stations";
import {
  computeDatumsFromObservations,
  observedMeanLevel,
  toFixed,
  type Datums,
  type Sample,
  type ObservedTidalDatumsResult,
} from "@slackwater/datums";

const HARMONIC_KEYS = [
  "HAT",
  "LAT",
  "LLWLT",
  "MHWS",
  "MLWS",
  "NLLW",
  "ALLW",
  "TLT",
];
const OBSERVED_KEYS = ["MSL", "MHHW", "MHW", "MTL", "MLW", "MLLW"];

export const OBSERVED_DATUM_NOTICE =
  "Mean datums use one continuous observation window of whole years. Short gaps may contain model-assisted inferred hourly heights.";
export const HARMONIC_DATUM_NOTICE =
  "Datums derived from harmonic prediction; observations do not support a mean-datum reduction over twelve continuous whole months after bounded short-gap reconstruction. Datum values carry higher uncertainty.";
export const OBSERVED_OFFSET_NOTICE =
  "A calendar-balanced mean of complete prepared observation months supplies the vertical offset; the months may span a different period from the pinned prediction.";
export const CONSTITUENT_FRAME_NOTICE =
  "Complete prepared observations do not cover every calendar month of the year for a balanced gauge mean; datums remain in the constituent frame (MSL = 0).";

export interface TiconDatumResult {
  datums: Datums;
  datums_source: "observed" | "harmonic";
  epoch: { start: string; end: string };
  datum_epoch?: { start: string; end: string };
  datum_notice: string;
  coverage?: ObservedTidalDatumsResult["coverage"];
}

export function reduceTiconDatums(
  samples: Sample[],
  constituents: PartialStationData["harmonic_constituents"],
  harmonic: Datums,
  fitEpoch: { start: Date; end: Date },
): TiconDatumResult {
  const observed = computeDatumsFromObservations(samples, constituents);
  if (observed) {
    return {
      datums: {
        ...Object.fromEntries(
          OBSERVED_KEYS.filter((key) => observed.datums[key] !== undefined).map(
            (key) => [key, observed.datums[key]!],
          ),
        ),
        ...shiftHarmonicDatums(harmonic, observed.datums["MSL"] ?? 0),
      },
      datums_source: "observed",
      epoch: {
        start: fitEpoch.start.toISOString().slice(0, 10),
        end: fitEpoch.end.toISOString().slice(0, 10),
      },
      datum_epoch: {
        start: observed.start.toISOString().slice(0, 10),
        end: observed.end.toISOString().slice(0, 10),
      },
      coverage: observed.coverage,
      datum_notice: OBSERVED_DATUM_NOTICE,
    };
  }
  const observedOffset = observedMeanLevel(samples, constituents);
  const offset = observedOffset ?? 0;
  return {
    datums: Object.fromEntries(
      Object.entries(harmonic).map(([key, value]) => [
        key,
        toFixed(value + offset, 3),
      ]),
    ),
    datums_source: "harmonic",
    epoch: {
      start: fitEpoch.start.toISOString().slice(0, 10),
      end: fitEpoch.end.toISOString().slice(0, 10),
    },
    datum_notice: `${HARMONIC_DATUM_NOTICE} ${observedOffset === undefined ? CONSTITUENT_FRAME_NOTICE : OBSERVED_OFFSET_NOTICE}`,
  };
}

/** Reject legacy reductions even when the constituents have not changed. */
export function cachedDatumNotice(
  station: Pick<
    PartialStationData,
    "datums_source" | "datum_epoch" | "disclaimers"
  >,
): string | undefined {
  if (
    station.datums_source === "observed" &&
    station.datum_epoch &&
    station.disclaimers?.includes(OBSERVED_DATUM_NOTICE)
  )
    return OBSERVED_DATUM_NOTICE;
  if (station.datums_source === "harmonic")
    for (const frame of [OBSERVED_OFFSET_NOTICE, CONSTITUENT_FRAME_NOTICE]) {
      const notice = `${HARMONIC_DATUM_NOTICE} ${frame}`;
      if (station.disclaimers?.includes(notice)) return notice;
    }
  return undefined;
}

function shiftHarmonicDatums(harmonic: Datums, msl: number): Datums {
  return Object.fromEntries(
    HARMONIC_KEYS.filter((key) => harmonic[key] !== undefined).map((key) => [
      key,
      toFixed(harmonic[key]! + msl, 3),
    ]),
  );
}
