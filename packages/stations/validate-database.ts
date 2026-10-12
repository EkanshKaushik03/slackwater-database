import assert from "node:assert/strict";
import { evaluateQuality } from "./evaluate-quality.ts";
import { loadProductionCatalogue } from "./load-catalogue.ts";
import { cleanName } from "./name-cleanup.ts";
import { classifyPosition } from "./position-audit.ts";
import {
  planStationFiles,
  publishedPaths,
  pathsChangingHands,
  publishedPathsAt,
  readStationFiles,
  stationFilesAt,
  ROOT,
} from "./station-files.ts";

// Quality is evaluated again, not read back, so a code or data change that
// alters a record's evaluation shows as a stale station file.
const files = readStationFiles();
const quality = new Map((await evaluateQuality()).map((q) => [q.id, q]));
const catalogue = await loadProductionCatalogue(ROOT, files, quality);

// Every route, path, redirect, member and position audit is what the station
// files record, or a code or data change moved one without npm run stations.
const stale = await planStationFiles(
  files,
  catalogue.stations,
  catalogue.routes,
);
assert.deepEqual(
  stale.map(({ file, from }) => from ?? file),
  [],
  "station files are stale; run npm run stations",
);

// A published path never disappears and never changes hands: a station that
// moves or is absorbed keeps its old path in some station's redirect_from.
// Checked against PUBLISHED_REF, such as origin/main, when it is set.
const ref = process.env["PUBLISHED_REF"];
if (ref) {
  const now = publishedPaths(files);
  const lost = [...publishedPathsAt(ref)].filter((path) => !now.has(path));
  assert.deepEqual(
    lost,
    [],
    `paths ${ref} publishes no longer resolve; add each to the redirect_from of the station that holds it`,
  );
  const before = stationFilesAt(ref);
  if (before) {
    assert.deepEqual(
      pathsChangingHands(before, files),
      [],
      `paths ${ref} publishes now name other water`,
    );
    // A retired id the ref never listed is a typo, not a record that vanished.
    const listed = new Set(
      before.flatMap(({ sources, retired_sources = [] }) => [
        ...sources,
        ...retired_sources,
      ]),
    );
    assert.deepEqual(
      files.flatMap(({ file, retired_sources = [] }) =>
        retired_sources
          .filter((id) => !listed.has(id))
          .map((id) => `${file}: ${id}`),
      ),
      [],
      `station files retire records ${ref} never listed; check each id`,
    );
  }
}

// A CHS station is in Canada: the generalized maritime boundary can hand a
// Gulf Islands gauge to Washington when its station is first written. Saint-
// Pierre, which IWLS serves beside Canada's ports, is the one exception.
assert.deepEqual(
  files.flatMap(({ file, country, sources }) =>
    sources.some((id) => id.startsWith("chs-")) &&
    !["CA", "PM"].includes(country)
      ? [file]
      : [],
  ),
  [],
  "CHS stations filed outside Canada; move each file to stations/<kind>/ca/",
);

// A published name is a fixed point of the cleanup, or a regeneration rewrites
// names on its own (#244). A curated name is exempt: it is what the cleanup
// could not produce.
// In a station this repo owns, the name is the owned record's alone.
const curatedNames = new Set(
  files.flatMap(({ name, provider, sources }) =>
    !name ? [] : provider ? sources.slice(0, 1) : sources,
  ),
);
assert.deepEqual(
  catalogue.stations.flatMap((station) => {
    if (!station.name || curatedNames.has(station.id)) return [];
    const again = cleanName(
      station.name,
      station.country,
      station.region_code,
      station.source?.name === "Canadian Hydrographic Service",
    ).name;
    return again === station.name
      ? []
      : [`${station.id}: ${station.name} → ${again}`];
  }),
  [],
  "cleanName rewrites a published name",
);

const routeIds = new Set(
  [...catalogue.routes.tide, ...catalogue.routes.current].flatMap(
    ({ station_ids }) => station_ids,
  ),
);
const routed = catalogue.stations.filter(({ id }) => routeIds.has(id));
const verdicts = routed.map((station) => classifyPosition(station).verdict);
console.log(
  `validated ${catalogue.stations.length} stations and ${routeIds.size} routed records in ${files.length} station files; warnings: ${routed.filter(({ locality }) => !locality).length} without locality, ${routed.filter(({ region_code }) => !region_code).length} without region code, ${verdicts.filter((v) => v === "ashore").length} pinned ashore, ${verdicts.filter((v) => v === "unverifiable").length} outside coastline coverage`,
);
if (catalogue.redundantNames.length)
  console.log(
    `${catalogue.redundantNames.length} name corrections match what the cleanup already produces:\n  ${catalogue.redundantNames.join("\n  ")}`,
  );
