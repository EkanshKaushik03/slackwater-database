/**
 * Which record a TICON relay was copied from, when the relay says so.
 *
 * Only declared provenance counts: a relay's own id naming a NOAA station or a
 * Kartverket code, or UHSLC metadata naming an originator this repo also
 * imports. An originator number has no namespace (UHSLC 071 is Wellington and
 * La Libertad), so each rule pairs a Data_Source pattern with the id shape
 * that provider uses.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pinned from "./uhslc-metadata.json" with { type: "json" };

/** The fields fetch-uhslc-metadata.ts pins from a UHSLC metadata file. */
export interface UhslcMetadata {
  station: string;
  latitude: number;
  longitude: number;
  /** First line of the first Data_Source entry. */
  data_source: string;
  originator_number: string;
  last_updated: string;
}

/** The UHSLC research-quality code in a TICON id, such as "073A". */
export function uhslcCode(ticonId: string): string | undefined {
  const parts = ticonId.replace(/^ticon\//, "").split("-");
  if (parts.at(-1) !== "uhslc_rq") return undefined;
  return parts.at(-3)?.toUpperCase();
}

/** A place name folded for matching: "Ny-Ålesund" and "Ny-Alesund" agree. */
function fold(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

let kartverketByName: Map<string, string> | undefined;

/** The Kartverket record with this place name. UHSLC records the Norwegian
 *  Hydrographic Service as originator without a station number, and
 *  Kartverket names one gauge per place. */
function kartverketRecord(station: string): string | undefined {
  if (!kartverketByName) {
    const dir = join(import.meta.dirname, "..", "..", "data", "kartverket");
    kartverketByName = new Map(
      readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => [
          fold(JSON.parse(readFileSync(join(dir, file), "utf8")).name),
          `kartverket/${file.replace(/\.json$/, "")}`,
        ]),
    );
  }
  return kartverketByName.get(fold(station));
}

const UHSLC_RULES: {
  source: RegExp;
  number: RegExp;
  id: (n: string, meta: UhslcMetadata) => string | undefined;
}[] = [
  {
    source: /^National Ocean Service|^NOAA|National Oceanic and Atmospheric/i,
    number: /^\d{7}$/,
    id: (n) => `noaa/${n}`,
  },
  {
    source: /^Land Information New Zealand/i,
    number: /^\d{3}$/,
    id: (n) => `linz/${n}`,
  },
  {
    source: /^Norwegian Hydrographic Service/i,
    number: /^$/,
    id: (_, meta) => kartverketRecord(meta.station),
  },
];

/** The record id a TICON relay declares as its originator, if any. */
export function declaredOriginator(
  ticonId: string,
  metadata: Record<string, UhslcMetadata> = pinned,
): string | undefined {
  const parts = ticonId.replace(/^ticon\//, "").split("-");
  // TICON's NOAA relays carry the NOAA station number in their own id, and
  // its Norwegian Hydrographic Service relays the Kartverket code.
  if (parts.at(-1) === "noaa") return `noaa/${parts.at(-3)}`;
  if (parts.at(-1) === "nhs")
    return `kartverket/${parts.at(-3)!.toUpperCase()}`;
  const code = uhslcCode(ticonId);
  const meta = code ? metadata[code] : undefined;
  if (!meta) return undefined;
  const rule = UHSLC_RULES.find(
    ({ source, number }) =>
      source.test(meta.data_source) && number.test(meta.originator_number),
  );
  return rule?.id(meta.originator_number, meta);
}
