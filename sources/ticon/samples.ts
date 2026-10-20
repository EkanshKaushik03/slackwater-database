import { getSourceSuffix } from "@slackwater/stations";
import { parseGeslaSamples, type Sample } from "@slackwater/datums";
import { parseGeslaSamplesInZone } from "@slackwater/harmonic-analysis";

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

export function parseTiconSamples(id: string, text: string): Sample[] {
  const source = LOCAL_TIME_SOURCES[getSourceSuffix(id)];
  if (!source) return parseGeslaSamples(text);
  return parseGeslaSamplesInZone(text, source.zone).map((p) => ({
    time: new Date(p.t + (source.shiftHours ?? 0) * 3600000),
    level: p.level,
  }));
}
