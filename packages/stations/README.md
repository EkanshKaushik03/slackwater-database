# Station tooling

NOAA current extraction, validation, and its reviewed bundle live in [`sources/noaa-current`](../../sources/noaa-current). The catalogue consumes that workspace bundle directly and has no separately released current-stations dependency.

## Build and validate the unified catalogue

Every published station is a file under [`stations/`](../../stations/README.md): its records, URL, redirects and anything curated about it. `metadata/places.json` is the reviewed GeoNames snapshot used for deterministic location enrichment; builds do not download mutable gazetteer data. `metadata/water-bodies.geojson` (OpenStreetMap bays and straits) supplies a station's derived `context`, and `metadata/maritime-zones.geojson` (Marine Regions EEZs) supplies the country of a station this repo owns. Both are reviewed snapshots too; refresh them with `npm run fetch-water-bodies -w packages/stations` and `npm run fetch-maritime-zones -w packages/stations`, then review the context and country changes before committing. See `metadata/PROVENANCE.md` for sources and licenses.

After changing source data or a station file, run from the repo root:

```shell
npm run stations
npm run validate:database
npm test
```

`npm run stations` gives each new record a station, moves a vanished record to `retired_sources`, and rewrites each station's `computed` block. It keeps curated fields and comments as written. `validate:database` fails when any station file is not what `npm run stations` would write, so review the station-file diff it produces: a changed position, path or member is a published station that moved.

Country codes are mandatory; locality and region codes may remain absent when there is no reliable value.
