/**
 * Pin the UHSLC research-quality metadata for every TICON relay of a UHSLC
 * record into uhslc-metadata.json, so matching a relay to its originator never
 * reads live data. UHSLC edits these files in place, so refresh deliberately
 * and review the diff.
 *
 * Usage: npm run fetch-uhslc-metadata -w sources/ticon
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { uhslcCode, type UhslcMetadata } from "./provenance.ts";

const BASE = "https://uhslc.soest.hawaii.edu/rqds/metadata_yaml";
const DATA_DIR = join(import.meta.dirname, "..", "..", "data", "ticon");
const OUT = join(import.meta.dirname, "uhslc-metadata.json");

const codes = [
  ...new Set(
    readdirSync(DATA_DIR).flatMap((file) => {
      const code = uhslcCode(file.replace(/\.json$/, ""));
      return code ? [code] : [];
    }),
  ),
].sort();

const firstLine = (value: unknown) =>
  (Array.isArray(value) ? String(value[0] ?? "") : String(value ?? ""))
    .split("\n")[0]!
    .trim();

const pinned: Record<string, UhslcMetadata> = {};
const missing: string[] = [];
for (const code of codes) {
  const response = await fetch(`${BASE}/${code}meta.yaml`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) {
    missing.push(code);
    continue;
  }
  if (!response.ok) throw new Error(`${code}: HTTP ${response.status}`);
  const meta = parse(await response.text());
  // A 200 that is not a station's metadata (an HTML error page, say) would
  // pin empty entries and quietly drop every provenance match.
  if (!meta?.Location?.Station)
    throw new Error(`${code}: response is not UHSLC station metadata`);
  const originator = String(meta.Location?.Originator_Number ?? "").trim();
  pinned[code] = {
    station: String(meta.Location?.Station ?? ""),
    latitude: Number(meta.Location?.Latitude),
    longitude: Number(meta.Location?.Longitude),
    data_source: firstLine(meta.Data_Source),
    originator_number: originator,
    last_updated: String(meta.Last_Updated ?? ""),
  };
}

// Losing most of the extract at once is UHSLC moving its files, not relays
// losing their metadata, and would quietly drop every provenance match.
const before = existsSync(OUT)
  ? Object.keys(JSON.parse(readFileSync(OUT, "utf8"))).length
  : 0;
if (Object.keys(pinned).length < before / 2)
  throw new Error(
    `only ${Object.keys(pinned).length} of ${codes.length} relays have metadata, against ${before} pinned; check ${BASE} before refreshing`,
  );
writeFileSync(OUT, `${JSON.stringify(pinned, null, 2)}\n`);
console.log(
  `pinned ${Object.keys(pinned).length} of ${codes.length} relays; no metadata for ${missing.join(", ") || "none"}`,
);
