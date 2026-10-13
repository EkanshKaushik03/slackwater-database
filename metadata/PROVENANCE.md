# Provenance

The reference data the database builder derives station fields from, and where each comes from. The provenance of the stations this repo owns, field by field, is in [stations/README.md](../stations/README.md#provenance).

## Place names

The database builder uses
**GeoNames cities500, CC BY 4.0** to derive locality, subdivision, country, and
fallback context fields when curated and provider data do not supply them.

`places.json` is a reviewed, filtered snapshot: the ten nearest GeoNames
places, and the ten nearest that are not a section of a city, within 100 km of
every station in the catalogue. `packages/stations/fetch-places.ts` builds it
(`npm run refresh:places -w packages/stations`). The committed snapshot was built
from `cities500.zip` and `admin1CodesASCII.txt` downloaded on 2026-09-27
(SHA-256 `7a95c3f8f415ad2b31840625032f826a14bbf39ffbc22827a5004cb95c7ed093`
and `1da92a6323a5fec3176f3f743bf4cf4040fd56a876da55e46fbca23c863aa60a`).
Names are the ones GeoNames publishes, accents included. A section of a city
(feature code PPLX) is flagged `section` and never labels a station. The
committed snapshot makes generation reproducible and reviewable; updating it is
an explicit source-data change rather than a side effect of building.

The snapshot is not included in the published database or npm package. Only
the derived station fields are written to TCDB. GeoNames contains no tide or
current station records:

- The rule is _don't redistribute a **provider's** station file_ — CHS's or NOAA's list of the
  things we publish records about. GeoNames publishes no tide or current stations, so nothing
  here overlaps a provider's compilation.
- A derived value is the lowest-precedence tier and is always beaten by a station
  file's curation or the provider's data.
- A same-country check prevents a nearby place across a border from supplying
  locality or subdivision data.
- Localities farther than 40 km remain empty rather than naming a misleading place.

If that trade ever stops being worth it, the exit is cheap: remove GeoNames from
the build, and optional location fields remain absent.

## Water bodies

A station with no curated or provider context takes the name of the bay or strait it sits in from **OpenStreetMap, ODbL 1.0, © OpenStreetMap contributors**. GeoNames names the nearest place only when no water body contains the station or lies within 1 km of it.

`water-bodies.geojson` is a reviewed snapshot of the named `natural=bay` and `natural=strait` ways and relations that contain a station in the catalogue or lie within 1 km of one. `packages/stations/fetch-water-bodies.ts` builds it from the Overpass API. The snapshot keeps each relation's outer rings only, simplifies them, and records the English name where OpenStreetMap has one, otherwise a Latin-script local name. Marine Regions' gazetteer was the other candidate, but it has no polygons for water bodies the size of Elliott Bay or Hood Canal.

## Maritime zones

A new station takes its country from the **Marine Regions Maritime Boundaries Geodatabase, Exclusive Economic Zones, CC BY 4.0** (Flanders Marine Institute, marineregions.org) before it falls back to the nearest GeoNames place. The zone polygons end at a generalized coastline, so a station within 10 km of a zone takes that zone's country. A gauge up a harbor or inlet is the usual case. Across the Strait of Juan de Fuca the nearest place can be in the other country; the zone cannot. Once a station has a file, its directory holds the country.

`maritime-zones.geojson` is a reviewed snapshot built by `packages/stations/fetch-maritime-zones.ts`. It covers the half-degree cells within half a degree of each owned station's position and lists them as `coverage`. Each zone is clipped to those cells and simplified to about 100 m. Joint regimes and overlapping claims are left out.

Neither snapshot is included in the published database or npm package. Only the derived `context` and country fields reach the TCDB, and neither source publishes tide or current stations.

## UHSLC relay metadata

`sources/ticon/uhslc-metadata.json` pins five fields (station name, position, current data provider, originator number, last update) from the per-station metadata the University of Hawaii Sea Level Center publishes with its research-quality records, the Joint Archive for Sea Level (Caldwell, Merrifield and Thompson, 2015, NOAA NCEI, https://doi.org/10.7289/V5V40S7W). It is used only to match a TICON relay to the gauge it copies. None of it reaches the published database or npm package. `sources/ticon/fetch-uhslc-metadata.ts` refreshes it; review the diff before committing.
